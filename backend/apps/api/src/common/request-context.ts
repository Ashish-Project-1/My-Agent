import { randomBytes } from "node:crypto";
import { Traceparent, Ulid } from "@ua/contracts";
import { ulid } from "ulid";

/** The correlation ids every request carries (docs/planning/07 §1). */
export interface RequestContext {
  readonly requestId: string;
  readonly traceId: string;
}

export function newRequestId(): string {
  return ulid();
}

/** W3C trace context: sampled, with fresh random trace and span ids. */
export function newTraceId(): string {
  return `00-${randomBytes(16).toString("hex")}-${randomBytes(8).toString("hex")}-01`;
}

/** A repeated header arrives as an array; anything but a single value is ignored. */
function singleValue(header: string | string[] | undefined): string | undefined {
  return typeof header === "string" ? header : undefined;
}

function isAllZero(hex: string): boolean {
  return /^0+$/.test(hex);
}

/**
 * The correlation ids for one request.
 *
 * An inbound value is honoured only when it is well formed, so a client cannot
 * inject an arbitrary string into our logs, our audit rows, or an error body —
 * `ProblemDetails` validates both fields, and an unvalidated one would turn
 * every error response into `internal_error`.
 */
export function requestContext(
  headers: Record<string, string | string[] | undefined>,
): RequestContext {
  const inboundRequestId = singleValue(headers["x-request-id"]);
  const inboundTraceId = singleValue(headers.traceparent);
  const parts = inboundTraceId?.split("-");

  const usableTraceId =
    inboundTraceId !== undefined &&
    Traceparent.safeParse(inboundTraceId).success &&
    parts?.length === 4 &&
    !isAllZero(parts[1] ?? "") &&
    !isAllZero(parts[2] ?? "");

  return {
    requestId:
      inboundRequestId !== undefined && Ulid.safeParse(inboundRequestId).success
        ? inboundRequestId
        : newRequestId(),
    traceId: usableTraceId ? (inboundTraceId as string) : newTraceId(),
  };
}
