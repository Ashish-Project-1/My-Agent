import { z } from "zod";
import { Timestamp, Uuid } from "./common.js";

/**
 * Devices (docs/planning/07 §3.6, `06` §2.2, Phase 4).
 *
 * Two kinds of caller meet here: a signed-in member (session cookie, CSRF) who
 * pairs and revokes, and the device itself, which presents no cookie at all —
 * it signs each request with a private key that never leaves its own disk
 * (FR-DEV-01). The canonical string both sides agree on is below; the Ed25519
 * maths is deliberately *not* in this package, because the browser imports it.
 */

export const DeviceStatus = z.enum(["pending", "active", "revoked"]);
export type DeviceStatus = z.infer<typeof DeviceStatus>;

export const DeviceCommandState = z.enum(["pending", "sent", "acked", "expired"]);
export type DeviceCommandState = z.infer<typeof DeviceCommandState>;

/** Growing by one value per command the runner learns to honour. */
export const DeviceCommandKind = z.enum(["diagnostics_ping"]);
export type DeviceCommandKind = z.infer<typeof DeviceCommandKind>;

export const DeviceName = z.string().trim().min(1).max(120);

/**
 * base64 of a DER SubjectPublicKeyInfo — the format `crypto.KeyObject.export`
 * produces, so a runner never has to re-encode its own key.
 */
export const PublicKeyBase64 = z
  .string()
  .regex(/^[A-Za-z0-9+/]+={0,2}$/, "must be base64-encoded DER");

/** SHA-256 of the public key, hex. Doubles as the human-checkable pairing code. */
export const KeyFingerprint = z.string().regex(/^[0-9a-f]{64}$/, "must be a hex SHA-256");

/**
 * Capabilities are `jsonb` and stay open: a newer runner may report something
 * this API has never heard of, and the honest answer is to show it, not to
 * reject the device (FR-DEV-02).
 */
export const DeviceCapabilities = z.looseObject({
  gpu: z
    .object({
      name: z.string().max(120),
      vramMb: z.number().int().nonnegative(),
    })
    .optional(),
  models: z.array(z.string().max(200)).max(500).optional(),
  commands: z.array(z.string().max(200)).max(500).optional(),
  playwright: z.boolean().optional(),
});
export type DeviceCapabilities = z.infer<typeof DeviceCapabilities>;

/**
 * Crockford base32 with I, L, O and U removed, shown as `4K7Q-2M3X`: readable
 * over a phone call and impossible to mistype as a word (`07` §1).
 */
export const PAIRING_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/;
export const PairingCode = z.string().regex(PAIRING_CODE_PATTERN, "must be a pairing code");
export type PairingCode = z.infer<typeof PairingCode>;

// --- Member-facing (session cookie) -----------------------------------------

export const CreatePairingCodeRequest = z.object({}).strict();
export type CreatePairingCodeRequest = z.infer<typeof CreatePairingCodeRequest>;

/** The code is returned exactly once, to the person who asked for it. */
export const PairingCodeResponse = z
  .object({
    id: Uuid,
    code: PairingCode,
    expiresAt: Timestamp,
  })
  .strict();
export type PairingCodeResponse = z.infer<typeof PairingCodeResponse>;

export const DeviceSummary = z
  .object({
    id: Uuid,
    /** The member who paired it — who may revoke or command it without being an admin. */
    ownerUserId: Uuid,
    name: DeviceName,
    os: z.string().max(40),
    osVersion: z.string().max(60).nullable(),
    runnerVersion: z.string().max(40),
    status: DeviceStatus,
    keyAlgorithm: z.string().max(20),
    fingerprint: KeyFingerprint,
    capabilities: DeviceCapabilities.nullable(),
    lastSeenAt: Timestamp.nullable(),
    createdAt: Timestamp,
  })
  .strict();
export type DeviceSummary = z.infer<typeof DeviceSummary>;

export const DeviceListResponse = z.object({ devices: z.array(DeviceSummary) }).strict();
export type DeviceListResponse = z.infer<typeof DeviceListResponse>;

/** Approval may also give the device the name its owner will recognise. */
export const ApproveDeviceRequest = z.object({ name: DeviceName.optional() }).strict();
export type ApproveDeviceRequest = z.infer<typeof ApproveDeviceRequest>;

export const RevokeDeviceRequest = z.object({ reason: z.string().trim().min(1).max(500) }).strict();
export type RevokeDeviceRequest = z.infer<typeof RevokeDeviceRequest>;

// --- Device-facing (Ed25519-signed request) ---------------------------------

export const RegisterDeviceRequest = z
  .object({
    pairingCode: PairingCode,
    name: DeviceName,
    os: z.string().trim().min(1).max(40),
    osVersion: z.string().trim().max(60).nullish(),
    runnerVersion: z.string().trim().min(1).max(40),
    publicKey: PublicKeyBase64,
    keyAlgorithm: z.literal("ed25519"),
    fingerprint: KeyFingerprint,
    capabilities: DeviceCapabilities,
  })
  .strict();
export type RegisterDeviceRequest = z.infer<typeof RegisterDeviceRequest>;

/** The device is created `pending`; it may poll only once a human approves. */
export const RegisterDeviceResponse = z.object({ device: DeviceSummary }).strict();
export type RegisterDeviceResponse = z.infer<typeof RegisterDeviceResponse>;

export const DeviceCommandQuery = z
  .object({
    /** Last `seq` the device processed; 0 means "everything you have". */
    cursor: z.coerce.number().int().nonnegative().default(0),
    /** Long-poll budget. 0 returns immediately (the fallback posture). */
    waitSeconds: z.coerce.number().int().min(0).max(30).default(0),
  })
  .strict();
export type DeviceCommandQuery = z.infer<typeof DeviceCommandQuery>;

export const DeviceCommandSummary = z
  .object({
    id: Uuid,
    seq: z.number().int().positive(),
    kind: DeviceCommandKind,
    payload: z.record(z.string(), z.unknown()).nullish(),
    commandDigest: z.string().regex(/^[0-9a-f]{64}$/),
    expiresAt: Timestamp,
  })
  .strict();
export type DeviceCommandSummary = z.infer<typeof DeviceCommandSummary>;

export const DeviceCommandListResponse = z
  .object({
    commands: z.array(DeviceCommandSummary),
    /** Echoed back as the next cursor, so a reconnect resumes where it stopped. */
    cursor: z.number().int().nonnegative(),
  })
  .strict();
export type DeviceCommandListResponse = z.infer<typeof DeviceCommandListResponse>;

export const AckDeviceCommandRequest = z
  .object({
    outcome: z.enum(["acked", "failed"]),
    error: z.string().trim().max(500).nullish(),
  })
  .strict();
export type AckDeviceCommandRequest = z.infer<typeof AckDeviceCommandRequest>;

/**
 * The browser-side "run diagnostics" action (`12` §5.4). It names a kind rather
 * than carrying a payload, so the API decides what a command means and a client
 * cannot put arbitrary work in front of a runner.
 */
export const CreateDeviceCommandRequest = z.object({ kind: DeviceCommandKind }).strict();
export type CreateDeviceCommandRequest = z.infer<typeof CreateDeviceCommandRequest>;

export const CreateDeviceCommandResponse = z.object({ command: DeviceCommandSummary }).strict();
export type CreateDeviceCommandResponse = z.infer<typeof CreateDeviceCommandResponse>;

/**
 * The exact bytes a command's `commandDigest` covers, so the API that queues a
 * command and the runner that receives it hash the same thing without either
 * side guessing at JSON key order. `expiresAt` is the ISO string form the
 * device is sent, not a `Date`.
 */
export function canonicalDeviceCommand(input: {
  deviceId: string;
  kind: string;
  payload: Record<string, unknown> | null;
  expiresAt: string;
}): string {
  return JSON.stringify({
    v: 1,
    deviceId: input.deviceId,
    kind: input.kind,
    payload: input.payload ?? null,
    expiresAt: input.expiresAt,
  });
}

// --- Request signing (docs/planning/07 §3.6, `11` §T-DEV) -------------------

export const DEVICE_ID_HEADER = "x-ua-device-id";
export const DEVICE_TIMESTAMP_HEADER = "x-ua-timestamp";
export const DEVICE_SIGNATURE_HEADER = "x-ua-signature";

/**
 * How far a signed request may drift from the server clock. Narrow enough that
 * a captured request cannot be replayed next week, wide enough for a home PC
 * whose clock is a little off (`11` T-AUTH).
 */
export const DEVICE_SIGNATURE_MAX_AGE_MS = 5 * 60 * 1000;

/**
 * What both sides sign, byte for byte.
 *
 * The body digest is a parameter rather than a computation so this stays pure
 * and importable from the browser; each side hashes with its own crypto. The
 * path is included so a signature for `GET .../commands` cannot be spent on
 * `POST .../revoke`, and the version prefix means a future scheme change
 * cannot be silently accepted by an old verifier.
 */
export function canonicalDeviceRequest(input: {
  method: string;
  path: string;
  timestamp: string;
  bodySha256: string;
}): string {
  return ["v1", input.timestamp, input.method.toUpperCase(), input.path, input.bodySha256].join(
    "\n",
  );
}
