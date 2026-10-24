import { Injectable } from "@nestjs/common";
import type { DeviceCapabilities, DeviceCommandSummary, DeviceSummary } from "@ua/contracts";
import { forOrganization, type Prisma } from "@ua/database";
// Value import: Nest emits the constructor's token from runtime metadata.
import { UnscopedDatabase } from "../database/unscoped-database.js";
import type { DbWriter } from "../database/writer.js";

/** A device as the API exposes it (docs/planning/06 §2.2). */
export type DeviceRow = DeviceSummary;

const DEVICE_SELECT = {
  id: true,
  user_id: true,
  name: true,
  os: true,
  os_version: true,
  runner_version: true,
  status: true,
  key_algorithm: true,
  fingerprint: true,
  capabilities: true,
  last_seen_at: true,
  created_at: true,
} as const;

type RawDevice = {
  id: string;
  user_id: string;
  name: string;
  os: string;
  os_version: string | null;
  runner_version: string;
  status: DeviceSummary["status"];
  key_algorithm: string;
  fingerprint: string;
  capabilities: unknown;
  last_seen_at: Date | null;
  created_at: Date;
};

/**
 * What signature verification needs, read before any tenant is known: a signed
 * request names its device and nothing else, and the row it resolves to is what
 * supplies the organization (docs/planning/07 §3.6).
 */
export type DeviceAuthRow = {
  id: string;
  organization_id: string;
  user_id: string;
  status: DeviceSummary["status"];
  public_key: string;
};

/**
 * How long a command may sit `sent` before the API assumes the device never got
 * it. Longer than the longest poll wait (30s) so a device that is merely slow to
 * ack is not handed the same command twice back to back.
 */
const REQUEUE_AFTER_MS = 60_000;

const COMMAND_SELECT = {
  id: true,
  seq: true,
  kind: true,
  payload: true,
  command_digest: true,
  expires_at: true,
} as const;

function iso(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toDeviceRow(row: RawDevice): DeviceRow {
  return {
    id: row.id,
    ownerUserId: row.user_id,
    name: row.name,
    os: row.os,
    osVersion: row.os_version,
    runnerVersion: row.runner_version,
    status: row.status,
    keyAlgorithm: row.key_algorithm,
    fingerprint: row.fingerprint,
    // Capabilities were validated by `RegisterDeviceRequest` on the way in;
    // reading them back is a cast, not a second trust decision.
    capabilities: row.capabilities as DeviceCapabilities | null,
    lastSeenAt: iso(row.last_seen_at),
    createdAt: row.created_at.toISOString(),
  };
}

function toCommandRow(row: {
  id: string;
  seq: number;
  kind: DeviceCommandSummary["kind"];
  payload: unknown;
  command_digest: string;
  expires_at: Date;
}): DeviceCommandSummary {
  return {
    id: row.id,
    seq: row.seq,
    kind: row.kind,
    payload: (row.payload as Record<string, unknown> | null) ?? null,
    commandDigest: row.command_digest,
    expiresAt: row.expires_at.toISOString(),
  };
}

/**
 * Every device read and write in one place (docs/planning/03 §4).
 *
 * Sessions reach devices through `forOrganization`; the device itself, which
 * presents no tenant, reaches its own row by id and then everything else
 * through its row's `organization_id`. Those two paths are the only ones here.
 */
@Injectable()
export class DevicesRepository {
  constructor(private readonly database: UnscopedDatabase) {}

  /**
   * One unit of work: a device and the code it redeemed, or a revocation and the
   * commands it must not run, land together or not at all (docs/planning/06 §7).
   *
   * Deliberately unscoped — `forOrganization` cannot wrap a transaction client —
   * so every write below binds `organization_id` to the authenticated caller's
   * organization, never to anything from the request body.
   */
  transaction<T>(work: (writer: DbWriter) => Promise<T>): Promise<T> {
    return this.database.client.$transaction(work);
  }

  async listDevices(organizationId: string): Promise<DeviceRow[]> {
    const db = forOrganization(this.database.client, organizationId);
    const rows = await db.devices.findMany({
      select: DEVICE_SELECT,
      orderBy: { created_at: "desc" },
    });
    return rows.map(toDeviceRow);
  }

  async getDevice(organizationId: string, deviceId: string): Promise<DeviceRow | null> {
    const db = forOrganization(this.database.client, organizationId);
    const row = await db.devices.findFirst({ where: { id: deviceId }, select: DEVICE_SELECT });
    return row === null ? null : toDeviceRow(row);
  }

  /** Unscoped on purpose: this is the lookup that *establishes* the tenant. */
  async findDeviceForAuth(deviceId: string): Promise<DeviceAuthRow | null> {
    return this.database.client.devices.findUnique({
      where: { id: deviceId },
      select: {
        id: true,
        organization_id: true,
        user_id: true,
        status: true,
        public_key: true,
      },
    });
  }

  async findDeviceByFingerprint(
    organizationId: string,
    fingerprint: string,
  ): Promise<string | null> {
    const db = forOrganization(this.database.client, organizationId);
    const row = await db.devices.findFirst({ where: { fingerprint }, select: { id: true } });
    return row?.id ?? null;
  }

  async createPairingCode(
    writer: DbWriter,
    input: { organizationId: string; createdBy: string; codeHash: string; expiresAt: Date },
  ): Promise<{ id: string; expiresAt: Date }> {
    const row = await writer.device_pairing_codes.create({
      data: {
        organization_id: input.organizationId,
        created_by: input.createdBy,
        code_hash: input.codeHash,
        expires_at: input.expiresAt,
      },
      select: { id: true, expires_at: true },
    });
    return { id: row.id, expiresAt: row.expires_at };
  }

  /**
   * Unscoped on purpose: the code *is* the credential, and it is what names the
   * organization the device is about to join. Expiry and single use are part of
   * the lookup so a stale code cannot be redeemed by a slower query.
   */
  async findRedeemablePairingCode(
    codeHash: string,
    now: Date,
  ): Promise<{ id: string; organizationId: string; createdBy: string } | null> {
    const row = await this.database.client.device_pairing_codes.findFirst({
      where: { code_hash: codeHash, redeemed_at: null, expires_at: { gt: now } },
      select: { id: true, organization_id: true, created_by: true },
    });
    return row === null
      ? null
      : { id: row.id, organizationId: row.organization_id, createdBy: row.created_by };
  }

  /**
   * Returns false when another redemption won the race — the `redeemed_at: null`
   * condition is the lock, so a code cannot pair two devices (FR-AUTH-07).
   */
  async redeemPairingCode(
    writer: DbWriter,
    input: { codeId: string; deviceId: string; now: Date },
  ): Promise<boolean> {
    const result = await writer.device_pairing_codes.updateMany({
      where: { id: input.codeId, redeemed_at: null },
      data: { redeemed_at: input.now, redeemed_device_id: input.deviceId },
    });
    return result.count > 0;
  }

  async createDevice(
    writer: DbWriter,
    input: {
      organizationId: string;
      userId: string;
      name: string;
      os: string;
      osVersion: string | null;
      runnerVersion: string;
      publicKey: string;
      keyAlgorithm: string;
      fingerprint: string;
      capabilities: DeviceCapabilities;
    },
  ): Promise<DeviceRow> {
    const row = await writer.devices.create({
      data: {
        organization_id: input.organizationId,
        user_id: input.userId,
        name: input.name,
        os: input.os,
        os_version: input.osVersion,
        runner_version: input.runnerVersion,
        public_key: input.publicKey,
        key_algorithm: input.keyAlgorithm,
        fingerprint: input.fingerprint,
        // A `looseObject` has an `unknown` index signature and no `jsonb` shape
        // accepts that; the schema above is what made it JSON.
        capabilities: input.capabilities as Prisma.InputJsonValue,
        // `pending` until a human approves it in the browser (`12` §5.3).
        status: "pending",
      },
      select: DEVICE_SELECT,
    });
    return toDeviceRow(row);
  }

  async approveDevice(
    writer: DbWriter,
    input: { organizationId: string; deviceId: string; name: string | null },
  ): Promise<DeviceRow | null> {
    // `updateManyAndReturn` on purpose: a read-back through the outer client
    // cannot see this transaction's own write, so the updated row is taken from
    // the update itself.
    const rows = await writer.devices.updateManyAndReturn({
      where: {
        id: input.deviceId,
        organization_id: input.organizationId,
        // Only a device that is waiting can be approved; a revoked one stays
        // revoked, so an old approval cannot resurrect it (FR-DEV-08).
        status: "pending",
      },
      data: { status: "active", ...(input.name === null ? {} : { name: input.name }) },
      select: DEVICE_SELECT,
    });
    return rows.length === 0 ? null : toDeviceRow(rows[0] as RawDevice);
  }

  async revokeDevice(
    writer: DbWriter,
    input: {
      organizationId: string;
      deviceId: string;
      revokedBy: string;
      reason: string | null;
      now: Date;
    },
  ): Promise<DeviceRow | null> {
    const rows = await writer.devices.updateManyAndReturn({
      where: {
        id: input.deviceId,
        organization_id: input.organizationId,
        status: { not: "revoked" },
      },
      data: {
        status: "revoked",
        revoked_at: input.now,
        revoked_by: input.revokedBy,
        revoke_reason: input.reason,
      },
      select: DEVICE_SELECT,
    });
    return rows.length === 0 ? null : toDeviceRow(rows[0] as RawDevice);
  }

  /**
   * Commands queued for a revoked device must not be waiting if it ever comes
   * back — expiry is what makes revocation immediate for work already in flight.
   */
  async expireDeviceCommands(
    writer: DbWriter,
    input: { organizationId: string; deviceId: string },
  ): Promise<number> {
    const result = await writer.device_commands.updateMany({
      where: {
        organization_id: input.organizationId,
        device_id: input.deviceId,
        state: { in: ["pending", "sent"] },
      },
      data: { state: "expired" },
    });
    return result.count;
  }

  async countPendingCommands(organizationId: string, deviceId: string): Promise<number> {
    const db = forOrganization(this.database.client, organizationId);
    return db.device_commands.count({ where: { device_id: deviceId, state: "pending" } });
  }

  /**
   * Append the next command for a device.
   *
   * `shortcut: the sequence is allocated as max+1 in the caller's transaction,
   * which is safe while one human clicks "run diagnostics" at a time. Phase 5
   * dispatches step commands concurrently and must switch to an atomic counter.`
   */
  async createCommand(
    writer: DbWriter,
    input: {
      organizationId: string;
      deviceId: string;
      kind: DeviceCommandSummary["kind"];
      payload: Record<string, unknown> | null;
      commandDigest: string;
      expiresAt: Date;
    },
  ): Promise<DeviceCommandSummary> {
    const aggregate = await writer.device_commands.aggregate({
      where: { organization_id: input.organizationId, device_id: input.deviceId },
      _max: { seq: true },
    });
    const row = await writer.device_commands.create({
      data: {
        organization_id: input.organizationId,
        device_id: input.deviceId,
        kind: input.kind,
        ...(input.payload === null ? {} : { payload: input.payload as Prisma.InputJsonValue }),
        command_digest: input.commandDigest,
        seq: (aggregate._max.seq ?? 0) + 1,
        expires_at: input.expiresAt,
      },
      select: COMMAND_SELECT,
    });
    return toCommandRow(row);
  }

  /** Expired commands are marked, never delivered: a device must not run stale work. */
  async expireStaleCommands(organizationId: string, deviceId: string, now: Date): Promise<number> {
    const db = forOrganization(this.database.client, organizationId);
    const result = await db.device_commands.updateMany({
      where: { device_id: deviceId, state: { in: ["pending", "sent"] }, expires_at: { lt: now } },
      data: { state: "expired" },
    });
    return result.count;
  }

  async claimCommands(
    organizationId: string,
    input: { deviceId: string; cursor: number; take: number; now: Date },
  ): Promise<DeviceCommandSummary[]> {
    const db = forOrganization(this.database.client, organizationId);
    const requeueBefore = new Date(input.now.getTime() - REQUEUE_AFTER_MS);
    const rows = await db.device_commands.findMany({
      where: {
        device_id: input.deviceId,
        // The cursor is the last sequence the device *finished*, so an
        // unacknowledged command stays behind it and is eligible again.
        seq: { gt: input.cursor },
        expires_at: { gt: input.now },
        // Offline detection and requeue (FR-DEV-04): work handed out but never
        // acknowledged comes back after the window, rather than sitting `sent`
        // until it expires. This is why delivery is at-least-once and why a
        // runner must execute a command id idempotently.
        OR: [{ state: "pending" }, { state: "sent", sent_at: { lt: requeueBefore } }],
      },
      select: COMMAND_SELECT,
      orderBy: { seq: "asc" },
      take: input.take,
    });
    if (rows.length === 0) {
      return [];
    }

    // At-least-once on purpose (docs/planning/06 §2.2): the mark is not atomic
    // with the read, so a crash between them re-delivers, and the runner keys
    // execution on the command id.
    await db.device_commands.updateMany({
      where: { id: { in: rows.map((row) => row.id) }, state: { in: ["pending", "sent"] } },
      data: { state: "sent", sent_at: input.now },
    });
    return rows.map(toCommandRow);
  }

  /** Idempotent: a repeated ack of the same command is a no-op, not an error. */
  async ackCommand(input: {
    organizationId: string;
    deviceId: string;
    commandId: string;
    now: Date;
    /** What the command produced, or null for a command that produces nothing. */
    result: Record<string, unknown> | null;
    resultDigest: string | null;
    error: string | null;
  }): Promise<boolean> {
    const result = await this.database.client.device_commands.updateMany({
      where: {
        id: input.commandId,
        device_id: input.deviceId,
        organization_id: input.organizationId,
        state: { in: ["pending", "sent"] },
      },
      data: {
        state: "acked",
        acked_at: input.now,
        ...(input.result === null ? {} : { result: input.result as Prisma.InputJsonValue }),
        result_digest: input.resultDigest,
        error: input.error,
      },
    });
    if (result.count > 0) {
      return true;
    }
    // Already acked by an earlier attempt.
    const existing = await this.database.client.device_commands.findFirst({
      where: {
        id: input.commandId,
        device_id: input.deviceId,
        organization_id: input.organizationId,
      },
      select: { state: true },
    });
    return existing?.state === "acked";
  }

  /**
   * Unscoped by id on purpose, like every other step of device authentication:
   * the caller is the device itself, and the row was already resolved by the
   * guard. Nothing here can name a different device.
   */
  async touchLastSeen(deviceId: string, now: Date): Promise<void> {
    await this.database.client.devices.updateMany({
      where: { id: deviceId },
      data: { last_seen_at: now },
    });
  }
}
