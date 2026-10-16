import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import type { MembershipRole } from "@ua/contracts";
import { AppError } from "@ua/error-handling";
import type { FastifyRequest } from "fastify";
import type { RequestContext } from "./request-context.js";

/**
 * The authenticated caller: the session a request arrived on, the organization
 * that session is scoped to, and the role held there (docs/planning/10).
 *
 * Every field is derived server-side from stored rows. Nothing here can be
 * asserted by the caller, which is what stops a tenant or a role from being
 * taken from the request.
 */
export interface Principal {
  readonly userId: string;
  readonly sessionId: string;
  readonly organizationId: string;
  readonly role: MembershipRole;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by the global `AuthGuard`; absent on a public route. */
    principal?: Principal;
    /** Set by the request-context hook, before any handler runs. */
    context?: RequestContext;
  }
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.principal === undefined) {
      // Unreachable behind the global guard: only a @Public() route has no
      // principal, and a public route must not ask for one.
      throw new AppError("unauthenticated", "Sign in to continue.");
    }
    return request.principal;
  },
);
