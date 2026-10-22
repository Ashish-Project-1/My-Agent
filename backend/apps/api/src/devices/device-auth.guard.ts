import { type CanActivate, type ExecutionContext, Injectable, Logger } from "@nestjs/common";
import { DEVICE_ID_HEADER, Uuid } from "@ua/contracts";
import { AppError } from "@ua/error-handling";
import type { FastifyRequest } from "fastify";
import { checkDeviceSignature, signedRequestParts } from "./device-signature.js";
import { DevicesRepository } from "./devices.repository.js";

/**
 * Authenticates the device itself, on its Ed25519 signature (docs/planning/07
 * §3.6). Separate from `AuthGuard` on purpose: the two callers have different
 * credentials and different authorities, and one class that accepted either
 * would be the place a session quietly became a device or the reverse.
 *
 * Every request re-reads the device row, so revocation takes effect on the next
 * request rather than whenever a token would have expired (FR-DEV-08). A
 * failure is answered with one message for every cause — unknown device,
 * inactive device, bad signature — because the caller is the party that failed,
 * and telling it which half it got wrong helps nobody else.
 *
 * `shortcut: a rejected signature is logged but not recorded in `audit_events`.
 * An unauthenticated caller must not be able to write rows at will; the
 * rate-limited audit path arrives with the pairing limiter (`11` T-AUTH-08).`
 */
@Injectable()
export class DeviceAuthGuard implements CanActivate {
  private readonly logger = new Logger(DeviceAuthGuard.name);

  constructor(private readonly repository: DevicesRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers[DEVICE_ID_HEADER];
    const deviceId = typeof header === "string" ? header : null;
    const parts = signedRequestParts(request);

    const denied = new AppError(
      "unauthenticated",
      "This request is not signed by an active device.",
    );
    if (deviceId === null || parts.timestamp === null || parts.signature === null) {
      throw denied;
    }
    // Checked before the query: a malformed id must not reach the database as a
    // cast error and come back as a 500.
    if (!Uuid.safeParse(deviceId).success) {
      throw denied;
    }

    // The path names the device too, and the path *is* signed. Requiring the two
    // to agree keeps "the device this URL is about" and "the device that
    // authenticated" from ever being different rows.
    const pathDeviceId = (request.params as { deviceId?: string }).deviceId;
    if (pathDeviceId !== undefined && pathDeviceId !== deviceId) {
      throw denied;
    }

    const device = await this.repository.findDeviceForAuth(deviceId);
    if (device === null || device.status !== "active") {
      // Not `forbidden`: the device learns nothing beyond "this identity does
      // not work", which is also what a revoked device experiences.
      throw denied;
    }

    const check = checkDeviceSignature({
      method: parts.method,
      path: parts.path,
      timestamp: parts.timestamp,
      body: parts.body,
      signature: parts.signature,
      publicKey: device.public_key,
      now: new Date(),
    });
    if (!check.ok) {
      this.logger.warn(`device ${deviceId} signature rejected: ${check.reason}`);
      throw denied;
    }

    request.devicePrincipal = {
      deviceId: device.id,
      organizationId: device.organization_id,
      userId: device.user_id,
    };
    return true;
  }
}
