import { z } from "zod";

/**
 * UUIDv7 (RFC 9562) as minted by the platform. The version and variant nibbles
 * are pinned so a v4 id copied in from anywhere else is rejected instead of
 * silently accepted (docs/planning/07 §1 "IDs", `06` §3).
 */
export const UUID_V7_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const Uuid = z.string().regex(UUID_V7_PATTERN, "must be a UUIDv7");
export type Uuid = z.infer<typeof Uuid>;

/** Crockford base32 ULID, used for correlation ids (`X-Request-Id`). */
export const ULID_PATTERN = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export const Ulid = z.string().regex(ULID_PATTERN, "must be a ULID");
export type Ulid = z.infer<typeof Ulid>;

/** `Idempotency-Key` accepts either form (docs/planning/07 §1 "Idempotency"). */
export const IdempotencyKey = z.union([Uuid, Ulid]);
export type IdempotencyKey = z.infer<typeof IdempotencyKey>;

/**
 * ISO 8601 UTC with milliseconds — the only timestamp format on the wire
 * (docs/planning/07 §1 "Timestamps"). Offsets, missing milliseconds and
 * second-precision values are rejected so two clients cannot disagree.
 */
export const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

export const Timestamp = z
  .string()
  .regex(TIMESTAMP_PATTERN, "must be ISO 8601 UTC with milliseconds");
export type Timestamp = z.infer<typeof Timestamp>;

/** W3C trace context, propagated API → queue → worker → device (docs/planning/16). */
export const TRACEPARENT_PATTERN = /^[0-9a-f]{2}-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

export const Traceparent = z.string().regex(TRACEPARENT_PATTERN, "must be a W3C traceparent");
export type Traceparent = z.infer<typeof Traceparent>;

/** Money is minor units plus an ISO 4217 code, never a float (docs/planning/07 §1). */
export const Money = z
  .object({
    amountMinor: z.number().int(),
    currency: z.string().regex(/^[A-Z]{3}$/, "must be an ISO 4217 code"),
  })
  .strict();
export type Money = z.infer<typeof Money>;

/**
 * Keyset pagination only. `limit` defaults to 25 and is capped at 100; unknown
 * query parameters are rejected rather than ignored (docs/planning/07 §1).
 */
export const PaginationQuery = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).optional(),
  })
  .strict();
export type PaginationQuery = z.infer<typeof PaginationQuery>;
