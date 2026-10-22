import { createParamDecorator, type ExecutionContext } from "@nestjs/common";
import { AppError } from "@ua/error-handling";
import type { FastifyRequest } from "fastify";

/**
 * The authenticated device behind a signed request (docs/planning/07 §3.6).
 *
 * Deliberately not a `Principal`: there is no session, no role, and no choice of
 * tenant. The organization is the one the device was paired into, so a device
 * can only ever act as itself — it cannot be pointed at another tenant's data
 * by anything it sends.
 */
export interface DevicePrincipal {
  readonly deviceId: string;
  readonly organizationId: string;
  readonly userId: string;
}

declare module "fastify" {
  interface FastifyRequest {
    /** Set by `DeviceAuthGuard`; absent on every session-authenticated route. */
    devicePrincipal?: DevicePrincipal;
  }
}

export const CurrentDevice = createParamDecorator(
  (_data: unknown, context: ExecutionContext): DevicePrincipal => {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.devicePrincipal === undefined) {
      // Unreachable behind `DeviceAuthGuard`: a route that asks for a device has
      // one, and a route that has none must not ask.
      throw new AppError("unauthenticated", "This route requires a device identity.");
    }
    return request.devicePrincipal;
  },
);
