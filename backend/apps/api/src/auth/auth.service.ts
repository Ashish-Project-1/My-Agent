import { randomBytes } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type {
  AuthSessionResponse,
  LoginRequest,
  MeResponse,
  OrganizationListResponse,
  RegisterRequest,
} from "@ua/contracts";
import { AppError } from "@ua/error-handling";
import type { Logger } from "@ua/logger";
// Value imports for injected classes: Nest resolves constructor dependencies
// from decorator metadata, which a type-only import erases.
import { AuditService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS } from "../audit/audit-actions.js";
import type { Principal } from "../common/principal.js";
import { isUniqueViolationOn } from "../common/prisma-errors.js";
import type { RequestMeta } from "../common/request-meta.js";
import { slugCandidates } from "../common/slug.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import {
  IdentityRepository,
  RefreshTokenAlreadyUsed,
  type SessionView,
} from "../identity/identity.repository.js";
import {
  type Argon2Params,
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "../identity/password.js";
import { csrfToken, digest, newToken, tokenHash } from "../identity/tokens.js";
import { LOGGER } from "../logging.module.js";

/** A session that was just created or rotated, with the raw credentials to set as cookies. */
export interface IssuedSession {
  readonly body: AuthSessionResponse;
  readonly sessionToken: string;
  readonly refreshToken: string;
  readonly csrfToken: string;
  readonly sessionMaxAgeSeconds: number;
  readonly refreshMaxAgeSeconds: number;
}

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

@Injectable()
export class AuthService {
  /** Memoised decoy, so equalising the timing of a failed lookup costs one hash per process. */
  private decoy: Promise<string> | null = null;

  constructor(
    private readonly identity: IdentityRepository,
    private readonly audit: AuditService,
    @Inject(CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Create an account, its personal organization and its first session.
   *
   * The account, the organization, the owner membership, the audit row and the
   * session are one unit of work: an account without an organization has nothing
   * to sign in to, and a session for a user that was rolled back must not exist.
   */
  async register(input: RegisterRequest, meta: RequestMeta): Promise<IssuedSession> {
    const now = new Date();
    const passwordHash = await hashPassword(input.password, this.argon2Params());
    const displayName = input.displayName ?? null;
    const organizationName = input.displayName ?? input.email.split("@")[0] ?? "Personal";

    const account = await this.createAccount({
      email: input.email,
      passwordHash,
      displayName,
      organizationName,
      meta,
    });

    return this.issueSession(account.userId, account.organizationId, meta, now);
  }

  async login(input: LoginRequest, meta: RequestMeta): Promise<IssuedSession> {
    const now = new Date();
    const emailDigest = digest(this.config.digestSecret, "email", input.email);
    const windowStart = new Date(
      now.getTime() - this.config.authRateLimitWindowMinutes * MS_PER_MINUTE,
    );

    const [accountFailures, addressFailures] = await Promise.all([
      this.identity.countFailedAttemptsForAccount(emailDigest, windowStart),
      this.identity.countFailedAttemptsForAddress(meta.ipHash, windowStart),
    ]);

    if (
      accountFailures >= this.config.authRateLimitMaxAttempts ||
      addressFailures >= this.config.authRateLimitMaxAttempts
    ) {
      await this.recordAttempt(emailDigest, meta, false);
      await this.audit.record({
        organizationId: null,
        actorType: "user",
        actorId: null,
        action: AUDIT_ACTIONS.authLogin,
        resourceType: "session",
        result: "denied",
        reason: "rate_limit_exceeded",
        ipHash: meta.ipHash,
        userAgentDigest: meta.userAgentDigest,
        traceId: meta.traceId,
      });
      throw new AppError("rate_limited", "Too many sign-in attempts. Try again later.");
    }

    const user = await this.identity.findUserForSignIn(input.email);

    // Verified even when the account does not exist, against a hash of a value
    // nobody knows, so both answers take the same time and differ only in text
    // (docs/planning/11 §5 "no user enumeration").
    const passwordMatches = await verifyPassword(
      user?.passwordHash ?? (await this.decoyHash()),
      input.password,
    );

    if (user === null || !passwordMatches) {
      await this.recordAttempt(emailDigest, meta, false);
      await this.audit.record({
        organizationId: null,
        actorType: "user",
        actorId: user?.id ?? null,
        action: AUDIT_ACTIONS.authLogin,
        resourceType: "session",
        result: "failure",
        reason: "invalid_credentials",
        ipHash: meta.ipHash,
        userAgentDigest: meta.userAgentDigest,
        traceId: meta.traceId,
      });
      throw new AppError("unauthenticated", "Incorrect email or password.");
    }

    if (user.status === "suspended") {
      await this.audit.record({
        organizationId: null,
        actorType: "user",
        actorId: user.id,
        action: AUDIT_ACTIONS.authLogin,
        resourceType: "session",
        result: "denied",
        reason: "account_suspended",
        ipHash: meta.ipHash,
        userAgentDigest: meta.userAgentDigest,
        traceId: meta.traceId,
      });
      throw new AppError("forbidden", "This account is suspended.");
    }

    if (user.status === "deleted") {
      // Identical to a wrong password: a deleted account is not something the
      // caller needs to learn.
      await this.recordAttempt(emailDigest, meta, false);
      await this.audit.record({
        organizationId: null,
        actorType: "user",
        actorId: user.id,
        action: AUDIT_ACTIONS.authLogin,
        resourceType: "session",
        result: "failure",
        reason: "account_deleted",
        ipHash: meta.ipHash,
        userAgentDigest: meta.userAgentDigest,
        traceId: meta.traceId,
      });
      throw new AppError("unauthenticated", "Incorrect email or password.");
    }

    const organizationId = await this.resolveOrganization(user.id, input.organizationId ?? null);

    // The parameters are in the hash, so a credential created under weaker ones
    // is upgraded here, where the plaintext is available (docs/planning/11 §5).
    if (passwordHashNeedsUpgrade(user.passwordHash, this.argon2Params())) {
      await this.identity.updatePasswordHash(
        user.id,
        await hashPassword(input.password, this.argon2Params()),
      );
      this.logger.info("password hash upgraded to the current parameters", { userId: user.id });
    }

    await this.identity.markSignedIn(user.id, now);
    await this.recordAttempt(emailDigest, meta, true);

    // A declared device name is a friendlier label than the raw user-agent, and
    // it is what the §3.1 request shape carries.
    const sessionMeta =
      input.deviceName === undefined ? meta : { ...meta, userAgent: input.deviceName };
    return this.issueSession(user.id, organizationId, sessionMeta, now);
  }

  /**
   * Rotate the refresh credential and revive the session.
   *
   * Reuse is treated as theft: a token that was already rotated means either a
   * replay or a leak, and the only safe answer is to end the whole lineage
   * (docs/planning/11 §5, and the Phase 2 exit criterion).
   *
   * shortcut: a client that fires two refreshes at once loses the session,
   * because the second presents an already-rotated token. Add a short grace
   * window on the just-rotated token when the web client actually does that.
   */
  async refresh(presentedRefresh: string | undefined, meta: RequestMeta): Promise<IssuedSession> {
    const now = new Date();

    if (presentedRefresh === undefined || presentedRefresh.length === 0) {
      throw new AppError("unauthenticated", "Sign in to continue.");
    }

    const token = await this.identity.findRefreshToken(tokenHash(presentedRefresh));
    if (token === null) {
      throw new AppError("unauthenticated", "Your session is no longer valid. Sign in again.");
    }

    if (token.usedAt !== null) {
      await this.revokeLineage(
        token.sessionId,
        token.organizationId,
        now,
        meta,
        "refresh_token_reused",
      );
      throw new AppError("unauthenticated", "Your session is no longer valid. Sign in again.");
    }

    if (
      token.revokedAt !== null ||
      token.sessionRevokedAt !== null ||
      token.sessionLogoutAt !== null
    ) {
      throw new AppError("unauthenticated", "Your session is no longer valid. Sign in again.");
    }

    if (token.expiresAt <= now) {
      throw new AppError("unauthenticated", "Your session has expired. Sign in again.");
    }

    const sessionToken = newToken();
    const refreshToken = newToken();
    const sessionExpiresAt = new Date(
      now.getTime() + this.config.sessionTtlMinutes * MS_PER_MINUTE,
    );
    const refreshExpiresAt = new Date(now.getTime() + this.config.refreshTtlDays * MS_PER_DAY);

    try {
      await this.identity.transaction(async (writer) => {
        await this.identity.rotateRefreshToken(writer, {
          tokenId: token.id,
          sessionId: token.sessionId,
          newSessionTokenHash: tokenHash(sessionToken),
          newRefreshTokenHash: tokenHash(refreshToken),
          refreshExpiresAt,
          sessionExpiresAt,
          at: now,
        });
        await this.audit.record(
          {
            organizationId: token.organizationId,
            actorType: "user",
            actorId: null,
            action: AUDIT_ACTIONS.authRefresh,
            resourceType: "session",
            resourceId: token.sessionId,
            ipHash: meta.ipHash,
            userAgentDigest: meta.userAgentDigest,
            traceId: meta.traceId,
          },
          writer,
        );
      });
    } catch (error) {
      if (error instanceof RefreshTokenAlreadyUsed) {
        // A request that raced this one claimed the token first. Same verdict.
        await this.revokeLineage(
          token.sessionId,
          token.organizationId,
          now,
          meta,
          "refresh_token_raced",
        );
        throw new AppError("unauthenticated", "Your session is no longer valid. Sign in again.");
      }
      throw error;
    }

    const view = await this.loadView(token.sessionId);
    return {
      body: this.toSessionResponse(view, sessionExpiresAt),
      sessionToken,
      refreshToken,
      csrfToken: csrfToken(this.config.digestSecret, token.sessionId),
      sessionMaxAgeSeconds: this.config.sessionTtlMinutes * 60,
      refreshMaxAgeSeconds: this.config.refreshTtlDays * 86_400,
    };
  }

  /** Revoking the session and every token of its lineage is one act. */
  async logout(principal: Principal, meta: RequestMeta): Promise<void> {
    const now = new Date();
    await this.identity.transaction(async (writer) => {
      await this.identity.revokeSession(writer, principal.sessionId, "logout", now);
      await this.identity.revokeSessionRefreshTokens(writer, principal.sessionId, now);
      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.authLogout,
          resourceType: "session",
          resourceId: principal.sessionId,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
        },
        writer,
      );
    });
  }

  async currentUser(principal: Principal): Promise<MeResponse> {
    const view = await this.loadView(principal.sessionId);
    return {
      user: this.toUserProfile(view),
      organizations: view.organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        role: organization.role,
      })),
      activeOrganizationId: view.activeOrganizationId,
    };
  }

  async listOrganizations(principal: Principal): Promise<OrganizationListResponse> {
    const organizations = await this.identity.listOrganizations(principal.userId);
    return {
      data: organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        role: organization.role,
      })),
      nextCursor: null,
    };
  }

  private async createAccount(input: {
    email: string;
    passwordHash: string;
    displayName: string | null;
    organizationName: string;
    meta: RequestMeta;
  }): Promise<{ userId: string; organizationId: string }> {
    for (const slug of slugCandidates(input.organizationName)) {
      try {
        return await this.identity.transaction(async (writer) => {
          const user = await this.identity.createUser(writer, {
            email: input.email,
            passwordHash: input.passwordHash,
            displayName: input.displayName,
          });

          const organization = await this.identity.createOrganization(writer, {
            name: input.organizationName,
            slug,
            kind: "personal",
          });

          await this.identity.createMembership(writer, {
            userId: user.id,
            organizationId: organization.id,
            role: "owner",
            invitedBy: null,
          });

          await this.audit.record(
            {
              organizationId: organization.id,
              actorType: "user",
              actorId: user.id,
              action: AUDIT_ACTIONS.userRegister,
              resourceType: "user",
              resourceId: user.id,
              ipHash: input.meta.ipHash,
              userAgentDigest: input.meta.userAgentDigest,
              traceId: input.meta.traceId,
            },
            writer,
          );

          return { userId: user.id, organizationId: organization.id };
        });
      } catch (error) {
        if (isUniqueViolationOn(error, "email")) {
          // shortcut: a taken address is answered with a conflict, which confirms
          // that the address has an account. Making the two answers identical
          // needs the mailer ("we emailed the address on file"), which arrives
          // with email verification in this phase.
          throw new AppError("conflict", "An account with this email address already exists.");
        }
        if (!isUniqueViolationOn(error, "slug")) {
          throw error;
        }
        // The slug was taken between generating the candidate and this insert.
        // The transaction rolled back, so the next candidate is tried cleanly.
      }
    }

    throw new AppError("conflict", "Could not allocate a name for the organization. Try again.");
  }

  private async issueSession(
    userId: string,
    organizationId: string,
    meta: RequestMeta,
    now: Date,
  ): Promise<IssuedSession> {
    const sessionToken = newToken();
    const refreshToken = newToken();
    const sessionExpiresAt = new Date(
      now.getTime() + this.config.sessionTtlMinutes * MS_PER_MINUTE,
    );
    const refreshExpiresAt = new Date(now.getTime() + this.config.refreshTtlDays * MS_PER_DAY);

    const { sessionId } = await this.identity.transaction(async (writer) => {
      const created = await this.identity.createSession(writer, {
        userId,
        organizationId,
        sessionTokenHash: tokenHash(sessionToken),
        refreshTokenHash: tokenHash(refreshToken),
        sessionExpiresAt,
        refreshExpiresAt,
        userAgent: meta.userAgent,
        ipHash: meta.ipHash,
      });

      await this.audit.record(
        {
          organizationId,
          actorType: "user",
          actorId: userId,
          action: AUDIT_ACTIONS.authLogin,
          resourceType: "session",
          resourceId: created.sessionId,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
        },
        writer,
      );

      return created;
    });

    const view = await this.loadView(sessionId);
    return {
      body: this.toSessionResponse(view, sessionExpiresAt),
      sessionToken,
      refreshToken,
      csrfToken: csrfToken(this.config.digestSecret, sessionId),
      sessionMaxAgeSeconds: this.config.sessionTtlMinutes * 60,
      refreshMaxAgeSeconds: this.config.refreshTtlDays * 86_400,
    };
  }

  private async revokeLineage(
    sessionId: string,
    organizationId: string,
    at: Date,
    meta: RequestMeta,
    reason: string,
  ): Promise<void> {
    await this.identity.transaction(async (writer) => {
      await this.identity.revokeSessionRefreshTokens(writer, sessionId, at);
      await this.identity.revokeSession(writer, sessionId, "refresh_reuse", at);
      await this.audit.record(
        {
          organizationId,
          actorType: "user",
          actorId: null,
          action: AUDIT_ACTIONS.authRefresh,
          resourceType: "session",
          resourceId: sessionId,
          result: "denied",
          reason,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
        },
        writer,
      );
    });
    this.logger.warn("refresh lineage revoked", { sessionId, reason });
  }

  private async resolveOrganization(userId: string, requested: string | null): Promise<string> {
    if (requested !== null) {
      const membership = await this.identity.findOrganizationForMember(userId, requested);
      if (membership === null) {
        // The same answer a wrong password gets: an organization the caller is
        // not in must not be confirmed to exist.
        throw new AppError("unauthenticated", "Incorrect email or password.");
      }
      return membership.id;
    }

    const organizations = await this.identity.listOrganizations(userId);
    const first = organizations[0];
    if (first === undefined) {
      // Registration always creates a personal organization, so this is
      // inconsistent data. Fail closed rather than invent a tenant.
      throw new AppError("forbidden", "This account has no organization to sign in to.");
    }
    return first.id;
  }

  private async loadView(sessionId: string): Promise<SessionView> {
    const view = await this.identity.loadSessionView(sessionId);
    if (view === null) {
      throw new AppError("internal_error", "The session could not be loaded.");
    }
    return view;
  }

  private async recordAttempt(
    emailDigest: string,
    meta: RequestMeta,
    success: boolean,
  ): Promise<void> {
    await this.identity.recordLoginAttempt({
      emailDigest,
      ipHash: meta.ipHash,
      success,
      method: "password",
    });
  }

  private toSessionResponse(view: SessionView, sessionExpiresAt: Date): AuthSessionResponse {
    return {
      user: this.toUserProfile(view),
      organizations: view.organizations.map((organization) => ({
        id: organization.id,
        name: organization.name,
        role: organization.role,
      })),
      activeOrganizationId: view.activeOrganizationId,
      // The credential is a cookie; a token in the body is for a first-party
      // native client that has no cookie jar (docs/planning/07 §1 "Auth").
      accessToken: null,
      expiresAt: sessionExpiresAt.toISOString(),
    };
  }

  private toUserProfile(view: SessionView): MeResponse["user"] {
    return {
      id: view.user.id,
      email: view.user.email,
      displayName: view.user.displayName,
    };
  }

  private argon2Params(): Argon2Params {
    return {
      memoryKib: this.config.argon2MemoryKib,
      timeCost: this.config.argon2TimeCost,
      parallelism: this.config.argon2Parallelism,
    };
  }

  /** A hash of a value nobody holds, verified when the account does not exist. */
  private decoyHash(): Promise<string> {
    this.decoy ??= hashPassword(randomBytes(32).toString("base64url"), this.argon2Params());
    return this.decoy;
  }
}
