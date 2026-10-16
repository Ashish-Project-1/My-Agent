import { Injectable } from "@nestjs/common";
import type { MembershipRole } from "@ua/contracts";
import type { OrgStatus, PrismaClient, SessionRevokedReason, UserStatus } from "@ua/database";
// Value import: Nest emits the constructor parameter's token from runtime
// metadata, so a type-only import would degrade the injectable token to Function.
import { UnscopedDatabase } from "../database/unscoped-database.js";
import type { DbWriter } from "../database/writer.js";

export interface UserProfileRow {
  readonly id: string;
  readonly email: string;
  readonly displayName: string | null;
}

/** A sign-in candidate: the profile plus the two fields only this path may read. */
export interface SignInUserRow extends UserProfileRow {
  readonly passwordHash: string;
  readonly status: UserStatus;
}

export interface OrganizationRow {
  readonly id: string;
  readonly name: string;
  readonly role: MembershipRole;
}

/** Everything a session response is built from. */
export interface SessionView {
  readonly user: UserProfileRow;
  readonly organizations: readonly OrganizationRow[];
  readonly activeOrganizationId: string;
}

/** The server-side facts a request is authorised against. */
export interface SessionContext {
  readonly sessionId: string;
  readonly userId: string;
  readonly organizationId: string;
  readonly role: MembershipRole;
  readonly userStatus: UserStatus;
  readonly organizationStatus: OrgStatus;
}

export interface RefreshTokenRow {
  readonly id: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly usedAt: Date | null;
  readonly revokedAt: Date | null;
  readonly expiresAt: Date;
  readonly sessionRevokedAt: Date | null;
  readonly sessionLogoutAt: Date | null;
}

export interface NewSession {
  readonly userId: string;
  readonly organizationId: string;
  readonly sessionTokenHash: string;
  readonly refreshTokenHash: string;
  readonly sessionExpiresAt: Date;
  readonly refreshExpiresAt: Date;
  readonly userAgent: string | null;
  readonly ipHash: string;
}

export interface RefreshRotation {
  readonly tokenId: string;
  readonly sessionId: string;
  readonly newSessionTokenHash: string;
  readonly newRefreshTokenHash: string;
  readonly refreshExpiresAt: Date;
  readonly sessionExpiresAt: Date;
  readonly at: Date;
}

/** Raised inside the rotation transaction when the token had already been used. */
export class RefreshTokenAlreadyUsed extends Error {
  constructor() {
    super("refresh token was already rotated");
    this.name = "RefreshTokenAlreadyUsed";
  }
}

const USER_PROFILE_SELECT = {
  id: true,
  email: true,
  display_name: true,
} as const;

/** Memberships of an organization that is not suspended — the ones worth offering. */
const ACTIVE_MEMBERSHIPS = {
  organization: { status: { not: "suspended" as const } },
};

/**
 * The identity and tenancy reads and writes.
 *
 * This is the only place in the API that talks to the unscoped client, and every
 * method here either operates on a table that is not organization-scoped
 * (`users`, `organizations`, `login_attempts`) or is asked for a specific user's
 * own memberships. Tenant-scoped domain data never comes through here — it goes
 * through `forOrganization` (ADR-008).
 */
@Injectable()
export class IdentityRepository {
  private readonly prisma: PrismaClient;

  constructor(database: UnscopedDatabase) {
    this.prisma = database.client;
  }

  /** One unit of work: either every write inside `work` lands, or none does. */
  transaction<T>(work: (writer: DbWriter) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(work);
  }

  async findUserForSignIn(email: string): Promise<SignInUserRow | null> {
    const row = await this.prisma.users.findUnique({
      where: { email },
      select: { ...USER_PROFILE_SELECT, password_hash: true, status: true },
    });
    return row === null
      ? null
      : {
          id: row.id,
          email: row.email,
          displayName: row.display_name,
          passwordHash: row.password_hash,
          status: row.status,
        };
  }

  async createUser(
    writer: DbWriter,
    input: { email: string; passwordHash: string; displayName: string | null },
  ): Promise<UserProfileRow> {
    const row = await writer.users.create({
      data: {
        email: input.email,
        password_hash: input.passwordHash,
        display_name: input.displayName,
      },
      select: USER_PROFILE_SELECT,
    });
    return { id: row.id, email: row.email, displayName: row.display_name };
  }

  async updatePasswordHash(userId: string, passwordHash: string): Promise<void> {
    await this.prisma.users.update({
      where: { id: userId },
      data: { password_hash: passwordHash },
    });
  }

  async markSignedIn(userId: string, at: Date): Promise<void> {
    await this.prisma.users.update({
      where: { id: userId },
      data: { last_login_at: at },
    });
  }

  async createOrganization(
    writer: DbWriter,
    input: { name: string; slug: string; kind: "personal" | "team" },
  ): Promise<{ id: string; name: string }> {
    const row = await writer.organizations.create({
      data: { name: input.name, slug: input.slug, kind: input.kind },
      select: { id: true, name: true },
    });
    return { id: row.id, name: row.name };
  }

  async createMembership(
    writer: DbWriter,
    input: {
      userId: string;
      organizationId: string;
      role: MembershipRole;
      invitedBy: string | null;
    },
  ): Promise<void> {
    await writer.memberships.create({
      data: {
        user_id: input.userId,
        organization_id: input.organizationId,
        role: input.role,
        invited_by: input.invitedBy,
      },
    });
  }

  /** Every organization the user belongs to, for the session response and the list. */
  async listOrganizations(userId: string): Promise<OrganizationRow[]> {
    const rows = await this.prisma.memberships.findMany({
      where: { user_id: userId, ...ACTIVE_MEMBERSHIPS },
      select: {
        organization_id: true,
        role: true,
        organization: { select: { name: true } },
      },
      orderBy: { joined_at: "asc" },
    });
    return rows.map((row) => ({
      id: row.organization_id,
      name: row.organization.name,
      role: row.role,
    }));
  }

  /**
   * The caller's own membership of one organization, or null.
   *
   * Null is what a foreign id produces, and the caller turns that into a 404 —
   * a 403 would confirm the organization exists (docs/planning/07 §1).
   */
  async findOrganizationForMember(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationRow | null> {
    const row = await this.prisma.memberships.findUnique({
      where: {
        user_id_organization_id: {
          user_id: userId,
          organization_id: organizationId,
        },
      },
      select: {
        role: true,
        organization: { select: { id: true, name: true, status: true } },
      },
    });
    if (row === null || row.organization.status === "suspended") {
      return null;
    }
    return {
      id: row.organization.id,
      name: row.organization.name,
      role: row.role,
    };
  }

  async createSession(writer: DbWriter, input: NewSession): Promise<{ sessionId: string }> {
    const session = await writer.sessions.create({
      data: {
        user_id: input.userId,
        organization_id: input.organizationId,
        token_hash: input.sessionTokenHash,
        user_agent: input.userAgent,
        ip_hash: input.ipHash,
        expires_at: input.sessionExpiresAt,
      },
      select: { id: true },
    });

    await writer.refresh_tokens.create({
      data: {
        session_id: session.id,
        // One lineage per session: the family id is the session id, so
        // "revoke the family" and "revoke this session's tokens" are one act
        // and reuse detection needs no second identifier.
        family_id: session.id,
        token_hash: input.refreshTokenHash,
        expires_at: input.refreshExpiresAt,
      },
    });

    return { sessionId: session.id };
  }

  /**
   * The session behind a presented credential, if it is still usable.
   *
   * The role is read from the membership rather than trusted from anywhere else,
   * and a session whose organization the user is no longer a member of resolves
   * to null — the fail-closed direction, since a stale membership must not keep
   * granting access.
   */
  async findSessionContext(sessionTokenHash: string, now: Date): Promise<SessionContext | null> {
    const row = await this.prisma.sessions.findFirst({
      where: {
        token_hash: sessionTokenHash,
        revoked_at: null,
        logout_at: null,
        expires_at: { gt: now },
      },
      select: {
        id: true,
        user_id: true,
        organization_id: true,
        user: {
          select: {
            status: true,
            memberships: { select: { organization_id: true, role: true } },
          },
        },
        organization: { select: { status: true } },
      },
    });

    if (row === null) {
      return null;
    }

    const membership = row.user.memberships.find(
      (candidate) => candidate.organization_id === row.organization_id,
    );
    if (membership === undefined) {
      return null;
    }

    return {
      sessionId: row.id,
      userId: row.user_id,
      organizationId: row.organization_id,
      role: membership.role,
      userStatus: row.user.status,
      organizationStatus: row.organization.status,
    };
  }

  async loadSessionView(sessionId: string): Promise<SessionView | null> {
    const row = await this.prisma.sessions.findUnique({
      where: { id: sessionId },
      select: {
        organization_id: true,
        user: {
          select: {
            ...USER_PROFILE_SELECT,
            memberships: {
              where: ACTIVE_MEMBERSHIPS,
              select: {
                organization_id: true,
                role: true,
                organization: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    if (row === null) {
      return null;
    }

    return {
      user: {
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.display_name,
      },
      organizations: row.user.memberships.map((membership) => ({
        id: membership.organization_id,
        name: membership.organization.name,
        role: membership.role,
      })),
      activeOrganizationId: row.organization_id,
    };
  }

  async revokeSession(
    writer: DbWriter,
    sessionId: string,
    reason: SessionRevokedReason,
    at: Date,
  ): Promise<void> {
    await writer.sessions.updateMany({
      where: { id: sessionId, revoked_at: null },
      data: {
        revoked_at: at,
        revoked_reason: reason,
        ...(reason === "logout" ? { logout_at: at } : {}),
      },
    });
  }

  async revokeSessionRefreshTokens(writer: DbWriter, sessionId: string, at: Date): Promise<number> {
    const result = await writer.refresh_tokens.updateMany({
      where: { session_id: sessionId, revoked_at: null },
      data: { revoked_at: at },
    });
    return result.count;
  }

  async findRefreshToken(tokenHash: string): Promise<RefreshTokenRow | null> {
    const row = await this.prisma.refresh_tokens.findUnique({
      where: { token_hash: tokenHash },
      select: {
        id: true,
        session_id: true,
        used_at: true,
        revoked_at: true,
        expires_at: true,
        session: {
          select: { organization_id: true, revoked_at: true, logout_at: true },
        },
      },
    });

    return row === null
      ? null
      : {
          id: row.id,
          sessionId: row.session_id,
          organizationId: row.session.organization_id,
          usedAt: row.used_at,
          revokedAt: row.revoked_at,
          expiresAt: row.expires_at,
          sessionRevokedAt: row.session.revoked_at,
          sessionLogoutAt: row.session.logout_at,
        };
  }

  /**
   * Claim the presented token and issue its successor.
   *
   * The claim is a compare-and-swap (`used_at: null` in the `where`), so two
   * requests presenting the same token cannot both succeed: the loser sees a
   * count of zero, `RefreshTokenAlreadyUsed` aborts the caller's transaction, and
   * the successor row it had just created rolls back with it.
   *
   * The session's own credential is rotated here too, so the response replaces
   * every cookie at once and an access token stolen from an earlier request is
   * dead the moment the real client refreshes.
   */
  async rotateRefreshToken(writer: DbWriter, input: RefreshRotation): Promise<void> {
    const successor = await writer.refresh_tokens.create({
      data: {
        session_id: input.sessionId,
        family_id: input.sessionId,
        token_hash: input.newRefreshTokenHash,
        expires_at: input.refreshExpiresAt,
      },
      select: { id: true },
    });

    const claimed = await writer.refresh_tokens.updateMany({
      where: { id: input.tokenId, used_at: null, revoked_at: null },
      data: { used_at: input.at, replaced_by: successor.id },
    });

    if (claimed.count !== 1) {
      throw new RefreshTokenAlreadyUsed();
    }

    await writer.sessions.update({
      where: { id: input.sessionId },
      data: {
        token_hash: input.newSessionTokenHash,
        expires_at: input.sessionExpiresAt,
        last_seen_at: input.at,
      },
    });
  }

  /** Failed sign-ins for one account inside the window (docs/planning/11 §5). */
  async countFailedAttemptsForAccount(emailDigest: string, since: Date): Promise<number> {
    return this.prisma.login_attempts.count({
      where: {
        email_digest: emailDigest,
        success: false,
        created_at: { gte: since },
      },
    });
  }

  /** Failed sign-ins from one address inside the window, across all accounts. */
  async countFailedAttemptsForAddress(ipHash: string, since: Date): Promise<number> {
    return this.prisma.login_attempts.count({
      where: { ip_hash: ipHash, success: false, created_at: { gte: since } },
    });
  }

  async recordLoginAttempt(input: {
    emailDigest: string;
    ipHash: string;
    success: boolean;
    method: string;
  }): Promise<void> {
    await this.prisma.login_attempts.create({
      data: {
        email_digest: input.emailDigest,
        ip_hash: input.ipHash,
        success: input.success,
        method: input.method,
      },
    });
  }
}
