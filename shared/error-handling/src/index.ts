import { ERROR_STATUS, type ErrorCode, type FieldError, ProblemDetails } from "@ua/contracts";
import type { z } from "zod";

/**
 * Placeholder documentation host for error `type` URIs. The real host is still
 * open (docs/planning/20 Q-O-*); the shape — a stable, dereferenceable URI per
 * code — is what clients depend on.
 */
export const DEFAULT_ERROR_TYPE_BASE = "https://docs.example.com/errors/";

/**
 * An error this platform raised deliberately, whose `detail` is written for the
 * user and is therefore safe to return.
 *
 * Anything that is *not* an `AppError` is, by definition, a bug. It is mapped to
 * `internal_error` and its message is never sent to the client, because that
 * message can contain a connection string, a file path, or another tenant's
 * data (docs/planning/07 §2).
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly detail: string;
  readonly fields: readonly FieldError[];

  constructor(code: ErrorCode, detail: string, fields: readonly FieldError[] = []) {
    super(detail);
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.detail = detail;
    this.fields = fields;
  }
}

/** A schema-validation failure, carrying the per-field pointers (docs/planning/07 §2). */
export class ValidationError extends AppError {
  constructor(fields: readonly FieldError[], detail = "The request failed validation.") {
    super("validation_failed", detail, fields);
    this.name = "ValidationError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** `approval_expired` → `Approval expired`. */
export function titleForCode(code: ErrorCode): string {
  const [first = code, ...rest] = code.split("_");
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(" ");
}

/** RFC 6901: `~` escapes to `~0` and `/` to `~1`. */
function toJsonPointer(path: readonly PropertyKey[]): string {
  if (path.length === 0) {
    return "";
  }
  const segments = path.map((segment) =>
    String(segment).replaceAll("~", "~0").replaceAll("/", "~1"),
  );
  return `/${segments.join("/")}`;
}

/** Turns Zod issues into `errors[]` entries, addressed by JSON Pointer (docs/planning/07 §2). */
export function fieldErrorsFromZod(error: z.ZodError): FieldError[] {
  return error.issues.map((issue) => ({
    pointer: toJsonPointer(issue.path),
    code: issue.code,
    detail: issue.message,
  }));
}

export interface ErrorContext {
  /** Request path, echoed as `instance`, e.g. `/v1/tasks/018f...`. */
  instance: string;
  /** `X-Request-Id`. Validate inbound values at the edge before calling this. */
  requestId: string;
  /** W3C `traceparent` for the request. */
  traceId: string;
  /** Override for the error-documentation host. */
  typeBase?: string;
}

/**
 * Maps any thrown value to an RFC 9457 `application/problem+json` body
 * (docs/planning/07 §2).
 *
 * Two guarantees, both of which are tested:
 *
 * 1. It never throws. An error responder that can itself fail turns one bad
 *    request into an outage.
 * 2. It never leaks. A non-`AppError` contributes nothing but `internal_error`,
 *    so an unexpected failure cannot place its message, its stack or its cause on
 *    the wire.
 */
export function toProblemDetails(error: unknown, context: ErrorContext): ProblemDetails {
  const typeBase = context.typeBase ?? DEFAULT_ERROR_TYPE_BASE;
  const candidate = isAppError(error)
    ? {
        type: `${typeBase}${error.code.replaceAll("_", "-")}`,
        title: titleForCode(error.code),
        status: error.status,
        code: error.code,
        detail: error.detail,
        instance: context.instance,
        requestId: context.requestId,
        traceId: context.traceId,
        ...(error.fields.length > 0 ? { errors: [...error.fields] } : {}),
      }
    : internalProblem(typeBase, context);

  // Guards our own construction: a malformed `errors[]` entry must not escape.
  const parsed = ProblemDetails.safeParse(candidate);
  return parsed.success ? parsed.data : internalProblem(typeBase, context);
}

function internalProblem(typeBase: string, context: ErrorContext): ProblemDetails {
  return {
    type: `${typeBase}internal-error`,
    title: "Internal error",
    status: ERROR_STATUS.internal_error,
    code: "internal_error",
    detail: "An unexpected error occurred. Quote the requestId when reporting it.",
    instance: context.instance,
    requestId: context.requestId,
    traceId: context.traceId,
  };
}
