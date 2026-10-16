import { type CanActivate, type ExecutionContext, Inject, Injectable } from "@nestjs/common";
// Value imports for injected classes: Nest resolves dependencies from decorator
// metadata, which a type-only import erases.
import { Reflector } from "@nestjs/core";
import { CSRF_COOKIE, CSRF_HEADER, SESSION_COOKIE } from "@ua/contracts";
import { AppError } from "@ua/error-handling";
import type { FastifyRequest } from "fastify";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { IdentityRepository } from "../identity/identity.repository.js";
import { csrfToken, safeEqual, tokenHash } from "../identity/tokens.js";
import { IS_PUBLIC } from "./public.decorator.js";

/** Methods that need the CSRF double-submit; a safe method cannot change state. */
const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The single place a request is authenticated (docs/planning/11 §5).
 *
 * It denies by default: every route needs a live session unless it is marked
 * `@Public()`. A route therefore cannot be left open by forgetting to add a
 * guard — the mistake that matters is the one that fails closed.
 *
 * The caller's tenant and role come from the stored session and membership, so
 * nothing about them can be asserted by the request.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityRepository,
    @Inject(CONFIG) private readonly _config: AppConfig,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (
      this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [
        context.getHandler(),
        context.getClass(),
      ])
    ) {
      return true;
    }

    const presented = request.cookies[SESSION_COOKIE];
    if (typeof presented !== "string" || presented.length === 0) {
      throw new AppError("unauthenticated", "Sign in to continue.");
    }

    const session = await this.identity.findSessionContext(tokenHash(presented), new Date());
    if (session === null) {
      throw new AppError("unauthenticated", "Your session is no longer valid. Sign in again.");
    }

    if (session.userStatus !== "active") {
      throw new AppError("forbidden", "This account is not active.");
    }

    if (session.organizationStatus !== "active") {
      throw new AppError("forbidden", "This organization is not active.");
    }

    if (UNSAFE_METHODS.has(request.method)) {
      this.assertCsrf(request, session.sessionId);
    }

    request.principal = {
      userId: session.userId,
      sessionId: session.sessionId,
      organizationId: session.organizationId,
      role: session.role,
    };

    return true;
  }

  /**
   * Double submit: the value in the header must match the one derived from this
   * session, not merely match the cookie. An attacker on a sibling subdomain can
   * set a cookie but cannot derive this value (docs/planning/07 §1 "Auth").
   */
  private assertCsrf(request: FastifyRequest, sessionId: string): void {
    const expected = csrfToken(this._config.digestSecret, sessionId);
    const cookie = request.cookies[CSRF_COOKIE];
    const header = request.headers[CSRF_HEADER];

    if (
      typeof cookie !== "string" ||
      typeof header !== "string" ||
      !safeEqual(cookie, expected) ||
      !safeEqual(header, expected)
    ) {
      throw new AppError("forbidden", "The request is missing a valid CSRF token.");
    }
  }
}
