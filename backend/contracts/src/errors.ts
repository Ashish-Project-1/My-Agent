import { z } from "zod";
import { Traceparent, Ulid } from "./common.js";

/**
 * Every error code the API can return (docs/planning/07 §2). The set is closed
 * on purpose: clients branch on `code`, so adding one is an additive change but
 * removing or renaming one is breaking and must fail the OpenAPI diff gate.
 */
export const ERROR_CODES = [
  "invalid_request",
  "validation_failed",
  "unauthenticated",
  "forbidden",
  "insufficient_role",
  "not_found",
  "conflict",
  "idempotency_conflict",
  "state_conflict",
  "approval_expired",
  "gone",
  "payload_too_large",
  "unprocessable_entity",
  "rate_limited",
  "internal_error",
  "bad_gateway",
  "service_unavailable",
  "gateway_timeout",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];
export const ErrorCode = z.enum(ERROR_CODES);

/**
 * The single code → HTTP status mapping. Nothing else in the codebase may
 * choose a status for an error (docs/planning/03 §5.12).
 */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  invalid_request: 400,
  validation_failed: 400,
  unauthenticated: 401,
  forbidden: 403,
  insufficient_role: 403,
  not_found: 404,
  conflict: 409,
  idempotency_conflict: 409,
  state_conflict: 409,
  approval_expired: 409,
  gone: 410,
  payload_too_large: 413,
  unprocessable_entity: 422,
  rate_limited: 429,
  internal_error: 500,
  bad_gateway: 502,
  service_unavailable: 503,
  gateway_timeout: 504,
};

export function isErrorCode(value: string): value is ErrorCode {
  return Object.hasOwn(ERROR_STATUS, value);
}

/**
 * A per-field validation failure, addressed by JSON Pointer. `pointer` may be
 * the empty string, which is the valid JSON Pointer for the whole document.
 */
export const FieldError = z
  .object({
    pointer: z.string(),
    code: z.string().min(1),
    detail: z.string(),
  })
  .strict();
export type FieldError = z.infer<typeof FieldError>;

/**
 * RFC 9457 `application/problem+json` (docs/planning/07 §2).
 *
 * `strict()` is a security control, not a style choice: it is what stops a
 * stack trace, an internal path or another tenant's data from being attached to
 * a response by a careless caller.
 */
export const ProblemDetails = z
  .object({
    type: z.string().min(1),
    title: z.string().min(1),
    status: z.number().int().min(400).max(599),
    code: ErrorCode,
    detail: z.string(),
    instance: z.string().min(1),
    requestId: Ulid,
    traceId: Traceparent,
    errors: z.array(FieldError).optional(),
  })
  .strict();
export type ProblemDetails = z.infer<typeof ProblemDetails>;
