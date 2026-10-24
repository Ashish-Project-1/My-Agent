import { Inject, Injectable, Logger } from "@nestjs/common";
import {
  type AckDeviceCommandRequest,
  type ApproveDeviceRequest,
  type CreateDeviceCommandRequest,
  type CreateDeviceCommandResponse,
  canonicalDeviceCommand,
  type DeviceCommandListResponse,
  type DeviceSummary,
  type PairingCodeResponse,
  type RegisterDeviceRequest,
  type RevokeDeviceRequest,
} from "@ua/contracts";
import { AppError } from "@ua/error-handling";
import type { FastifyRequest } from "fastify";
import { AuditService } from "../audit/audit.service.js";
import { AUDIT_ACTIONS } from "../audit/audit-actions.js";
import type { Principal } from "../common/principal.js";
import type { RequestMeta } from "../common/request-meta.js";
import type { AppConfig } from "../config.js";
import { CONFIG } from "../config.module.js";
import { digest } from "../identity/tokens.js";
import type { DevicePrincipal } from "./device-principal.js";
import {
  bodySha256,
  checkDeviceSignature,
  deviceFingerprint,
  signedRequestParts,
} from "./device-signature.js";
import { DevicesRepository } from "./devices.repository.js";
import { generatePairingCode, normalisePairingCode, PAIRING_CODE_TTL_MS } from "./pairing-code.js";

/**
 * A queued command that is never collected is stale work. The TTL is a guard
 * rail against a device that went away, not a delivery deadline.
 */
const COMMAND_TTL_MS = 5 * 60 * 1000;

/** How many commands one poll may collect. */
const COMMAND_BATCH = 20;

/** How often a long poll asks the database again. */
const POLL_INTERVAL_MS = 500;

/** Long-poll ceiling, matching `DeviceCommandQuery.waitSeconds`. */
const MAX_WAIT_MS = 30_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Devices: pairing, approval, revocation and the command channel
 * (docs/planning/07 §3.6, `12` §5.3–5.4, Phase 4).
 *
 * Two callers meet here and are never confused for each other. A member pairs,
 * approves and revokes through `Principal`; `requireControl` is what stops a
 * member acting on a colleague's machine. A device carries `DevicePrincipal`,
 * which a guard derived from a signature, so it can only act as itself, inside
 * the organization its own row names.
 */
@Injectable()
export class DevicesService {
  private readonly logger = new Logger(DevicesService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly repository: DevicesRepository,
    private readonly audit: AuditService,
  ) {}

  /**
   * Keyed with the server secret so the stored hash is useless on its own: a
   * plain SHA-256 of a 40-bit code would fall to an offline GPU search if the
   * table leaked (`11` §T-AUTH).
   */
  private codeHash(code: string): string {
    return digest(this.config.digestSecret, "device-pairing-code", normalisePairingCode(code));
  }

  /** The code is returned once, to the person who asked; only its hash is stored. */
  async createPairingCode(principal: Principal, meta: RequestMeta): Promise<PairingCodeResponse> {
    const code = generatePairingCode();

    const created = await this.repository.transaction(async (writer) => {
      const row = await this.repository.createPairingCode(writer, {
        organizationId: principal.organizationId,
        createdBy: principal.userId,
        codeHash: this.codeHash(code),
        expiresAt: new Date(Date.now() + PAIRING_CODE_TTL_MS),
      });

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.devicePairingCodeCreate,
          resourceType: "device_pairing_code",
          resourceId: row.id,
          result: "success",
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
        },
        writer,
      );

      return row;
    });

    return { id: created.id, code, expiresAt: created.expiresAt.toISOString() };
  }

  async list(organizationId: string): Promise<DeviceSummary[]> {
    return this.repository.listDevices(organizationId);
  }

  async get(organizationId: string, deviceId: string): Promise<DeviceSummary> {
    const device = await this.repository.getDevice(organizationId, deviceId);
    if (device === null) {
      // Another tenant's device is `not_found`, not `forbidden`: its existence
      // must not be disclosed (docs/planning/06 §5).
      throw new AppError("not_found", "That device was not found.");
    }
    return device;
  }

  /**
   * Present a device for approval (FR-AUTH-07, `12` §5.3).
   *
   * This is the one device route where the public key is not already known, so
   * the signature is checked against the key the caller just presented — which
   * proves possession of the private half without it ever travelling. The code
   * proves the other half of the handshake: that a member of this organization
   * asked for a device.
   */
  async register(
    request: FastifyRequest,
    input: RegisterDeviceRequest,
    meta: RequestMeta,
  ): Promise<DeviceSummary> {
    const parts = signedRequestParts(request);
    if (parts.timestamp === null || parts.signature === null) {
      throw new AppError("unauthenticated", "This request is not signed.");
    }

    const check = checkDeviceSignature({
      method: parts.method,
      path: parts.path,
      timestamp: parts.timestamp,
      body: parts.body,
      signature: parts.signature,
      publicKey: input.publicKey,
      now: new Date(),
    });
    if (!check.ok) {
      this.logger.warn(`device registration signature rejected: ${check.reason}`);
      throw new AppError("unauthenticated", "This request is not signed by the key it presents.");
    }

    // The API derives the fingerprint from the key rather than trusting the
    // claimed one, so what a human compares in the browser is the real key.
    if (deviceFingerprint(input.publicKey) !== input.fingerprint) {
      throw new AppError("invalid_request", "The fingerprint does not match the public key.");
    }

    // `shortcut: pairing is not rate-limited. 40 bits of single-use code with a
    // ten-minute life is not brute-forceable, so the limiter in `11` T-AUTH-08
    // is not what protects this flow; add it when pairing becomes a target.`
    const pairable = await this.repository.findRedeemablePairingCode(
      this.codeHash(input.pairingCode),
      new Date(),
    );
    if (pairable === null) {
      throw new AppError("invalid_request", "That pairing code is not valid.");
    }
    const code = pairable;

    return this.repository.transaction(async (writer) => {
      const existing = await this.repository.findDeviceByFingerprint(
        code.organizationId,
        input.fingerprint,
      );
      if (existing !== null) {
        throw new AppError("conflict", "That device is already registered.");
      }

      const created = await this.repository.createDevice(writer, {
        organizationId: code.organizationId,
        userId: code.createdBy,
        name: input.name,
        os: input.os,
        osVersion: input.osVersion ?? null,
        runnerVersion: input.runnerVersion,
        publicKey: input.publicKey,
        keyAlgorithm: input.keyAlgorithm,
        fingerprint: input.fingerprint,
        capabilities: input.capabilities,
      });

      // Single use, spent even though the device still awaits a human: a
      // captured code must not present a second device (FR-AUTH-07).
      const redeemed = await this.repository.redeemPairingCode(writer, {
        codeId: code.id,
        deviceId: created.id,
        now: new Date(),
      });
      if (!redeemed) {
        throw new AppError("conflict", "That pairing code has already been used.");
      }

      await this.audit.record(
        {
          organizationId: code.organizationId,
          actorType: "device",
          actorId: null,
          deviceId: created.id,
          action: AUDIT_ACTIONS.deviceRegister,
          resourceType: "device",
          resourceId: created.id,
          result: "success",
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { name: input.name, os: input.os, fingerprint: input.fingerprint },
        },
        writer,
      );

      return created;
    });
  }

  async approve(
    principal: Principal,
    deviceId: string,
    input: ApproveDeviceRequest,
    meta: RequestMeta,
  ): Promise<DeviceSummary> {
    const device = await this.get(principal.organizationId, deviceId);
    this.requireControl(principal, device);

    return this.repository.transaction(async (writer) => {
      const row = await this.repository.approveDevice(writer, {
        organizationId: principal.organizationId,
        deviceId,
        name: input.name ?? null,
      });
      if (row === null) {
        throw new AppError("state_conflict", "That device is not waiting for approval.");
      }

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.deviceApprove,
          resourceType: "device",
          resourceId: deviceId,
          result: "success",
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { fingerprint: device.fingerprint },
        },
        writer,
      );

      return row;
    });
  }

  /** Denial is recorded as a revocation, so a refused device leaves a trail. */
  async deny(principal: Principal, deviceId: string, meta: RequestMeta): Promise<DeviceSummary> {
    return this.revoke(principal, deviceId, { reason: "denied at pairing" }, meta);
  }

  /**
   * Revocation is the point of a device key (FR-DEV-08): the row stops being
   * `active`, so every later request fails at the guard, and the commands
   * already queued for it expire in the same transaction — nothing is waiting
   * if it reconnects.
   */
  async revoke(
    principal: Principal,
    deviceId: string,
    input: RevokeDeviceRequest,
    meta: RequestMeta,
  ): Promise<DeviceSummary> {
    const device = await this.get(principal.organizationId, deviceId);
    this.requireControl(principal, device);

    return this.repository.transaction(async (writer) => {
      const row = await this.repository.revokeDevice(writer, {
        organizationId: principal.organizationId,
        deviceId,
        revokedBy: principal.userId,
        reason: input.reason,
        now: new Date(),
      });
      if (row === null) {
        throw new AppError("state_conflict", "That device is already revoked.");
      }

      const expired = await this.repository.expireDeviceCommands(writer, {
        organizationId: principal.organizationId,
        deviceId,
      });

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.deviceRevoke,
          resourceType: "device",
          resourceId: deviceId,
          result: "success",
          reason: input.reason,
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { expired_commands: expired, fingerprint: device.fingerprint },
        },
        writer,
      );

      return row;
    });
  }

  /**
   * Queue a command for a device (`12` §5.4 "Diagnostics").
   *
   * `shortcut: `diagnostics_ping` is the only kind, so this endpoint queues that
   * and nothing else. Phase 5 adds step execution, which queues its own
   * commands from the dispatch path rather than from a browser request.`
   */
  async queueCommand(
    principal: Principal,
    deviceId: string,
    input: CreateDeviceCommandRequest,
    meta: RequestMeta,
  ): Promise<CreateDeviceCommandResponse> {
    const device = await this.get(principal.organizationId, deviceId);
    this.requireControl(principal, device);
    if (device.status !== "active") {
      throw new AppError("state_conflict", "That device is not active.");
    }

    const command = await this.repository.transaction(async (writer) => {
      const expiresAt = new Date(Date.now() + COMMAND_TTL_MS);
      const created = await this.repository.createCommand(writer, {
        organizationId: principal.organizationId,
        deviceId,
        kind: input.kind,
        payload: null,
        // Deterministic over what the device will receive, so the runner can
        // recompute it and see that a relayed command was not altered. The
        // sequence is deliberately not part of it — it is allocated later.
        commandDigest: bodySha256(
          canonicalDeviceCommand({
            deviceId,
            kind: input.kind,
            payload: null,
            expiresAt: expiresAt.toISOString(),
          }),
        ),
        expiresAt,
      });

      await this.audit.record(
        {
          organizationId: principal.organizationId,
          actorType: "user",
          actorId: principal.userId,
          action: AUDIT_ACTIONS.deviceCommandCreate,
          resourceType: "device_command",
          resourceId: created.id,
          result: "success",
          ipHash: meta.ipHash,
          userAgentDigest: meta.userAgentDigest,
          traceId: meta.traceId,
          metadata: { device_id: deviceId, kind: input.kind },
        },
        writer,
      );

      return created;
    });

    return { command };
  }

  /**
   * Collect commands for a device, optionally waiting for work to appear.
   *
   * Long-poll rather than a held socket: this is the documented fallback for a
   * network that will not carry the outbound WSS channel (ADR-003). The wait is
   * bounded so a device cannot camp on a connection forever.
   */
  async pollCommands(
    device: DevicePrincipal,
    input: { cursor: number; waitSeconds: number },
  ): Promise<DeviceCommandListResponse> {
    const deadline = Date.now() + Math.min(input.waitSeconds * 1000, MAX_WAIT_MS);
    const cursor = input.cursor;

    for (;;) {
      const now = new Date();
      await this.repository.expireStaleCommands(device.organizationId, device.deviceId, now);
      const commands = await this.repository.claimCommands(device.organizationId, {
        deviceId: device.deviceId,
        cursor,
        take: COMMAND_BATCH,
        now,
      });

      // Liveness is refreshed on an empty poll too: "offline" means the device
      // stopped asking, not that there was nothing to send (FR-DEV-04).
      await this.repository.touchLastSeen(device.deviceId, now);

      if (commands.length > 0) {
        return { commands, cursor: commands[commands.length - 1]?.seq ?? cursor };
      }
      if (Date.now() >= deadline) {
        return { commands: [], cursor };
      }
      await sleep(Math.min(POLL_INTERVAL_MS, Math.max(0, deadline - Date.now())));
    }
  }

  /** Acking is idempotent: a device retrying after a lost response is not an error. */
  async ackCommand(
    device: DevicePrincipal,
    commandId: string,
    input: AckDeviceCommandRequest,
  ): Promise<void> {
    const acked = await this.repository.ackCommand({
      organizationId: device.organizationId,
      deviceId: device.deviceId,
      commandId,
      now: new Date(),
      result: input.result === null || input.result === undefined ? null : input.result.payload,
      resultDigest: input.result?.digest ?? null,
      error: input.error ?? null,
    });

    if (!acked) {
      throw new AppError("not_found", "That command was not found.");
    }
    if (input.outcome === "failed") {
      this.logger.warn(`device ${device.deviceId} failed a command: ${input.error ?? "no detail"}`);
    }
  }

  /**
   * The public half of `requireControl`: another module that must know whether
   * the caller controls a device asks here instead of reading `devices` itself
   * (docs/planning/03 §4).
   */
  async requireDeviceControl(principal: Principal, deviceId: string): Promise<DeviceSummary> {
    const device = await this.get(principal.organizationId, deviceId);
    this.requireControl(principal, device);
    return device;
  }

  /**
   * Who may act on a device: the member who paired it, or an organization
   * admin. A plain member sees the device list — the org's own inventory — but
   * cannot command or revoke a colleague's machine (docs/planning/10).
   */
  private requireControl(principal: Principal, device: DeviceSummary): void {
    const isAdmin = principal.role === "owner" || principal.role === "admin";
    if (!isAdmin && principal.userId !== device.ownerUserId) {
      throw new AppError("insufficient_role", "Only the device's owner or an admin can do that.");
    }
  }
}
