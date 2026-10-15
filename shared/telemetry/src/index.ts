import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { Traceparent } from "@ua/contracts";

/**
 * Correlation for one unit of work, whatever the boundary: HTTP request, queue
 * job, device command, SSE event. One `requestId` and one `traceparent` travel
 * together for the whole life of a task (docs/planning/03 §6, `16`).
 *
 * The real OpenTelemetry exporter is wired once there is a collector to export
 * to (Phase 8); these are the ids that exporter will use, so they are defined
 * here rather than invented later in two places.
 */
export interface Correlation {
  /** `X-Request-Id`, a ULID. */
  requestId: string;
  /** W3C `traceparent`: version-traceId-spanId-flags. */
  traceparent: string;
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/**
 * A ULID: 48-bit millisecond timestamp then 80 random bits, Crockford base32.
 * Lexicographic order matches creation order, which is what makes it usable as
 * a log and event-correlation id.
 */
export function newRequestId(timestampMs: number = Date.now()): string {
  const value = (BigInt(timestampMs) << 80n) | BigInt(`0x${randomBytes(10).toString("hex")}`);

  let remaining = value;
  let encoded = "";
  for (let index = 0; index < 26; index += 1) {
    encoded = (CROCKFORD[Number(remaining & 31n)] ?? "0") + encoded;
    remaining >>= 5n;
  }
  return encoded;
}

export interface TraceContext {
  traceId: string;
  spanId: string;
  sampled: boolean;
}

const ZERO_TRACE_ID = "0".repeat(32);
const ZERO_SPAN_ID = "0".repeat(16);

export function newTraceId(): string {
  return randomBytes(16).toString("hex");
}

export function newSpanId(): string {
  return randomBytes(8).toString("hex");
}

export function formatTraceparent(context: TraceContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

/**
 * Parses a `traceparent`. Validity is decided by the contract, never by a second
 * regex here. Returns `undefined` for anything malformed — including the
 * all-zero trace or span id, which the specification forbids — so a caller always
 * starts a fresh trace rather than propagating a broken one.
 */
export function parseTraceparent(value: string): TraceContext | undefined {
  if (!Traceparent.safeParse(value).success) {
    return undefined;
  }
  const [, traceId = "", spanId = "", flags = ""] = value.split("-");
  if (traceId === ZERO_TRACE_ID || spanId === ZERO_SPAN_ID) {
    return undefined;
  }
  return { traceId, spanId, sampled: (Number.parseInt(flags, 16) & 0x01) === 0x01 };
}

/** Continues an inbound trace, or starts a new one, and gives the work a correlation id. */
export function startCorrelation(inboundTraceparent?: string): Correlation {
  const inbound =
    inboundTraceparent === undefined ? undefined : parseTraceparent(inboundTraceparent);
  return {
    requestId: newRequestId(),
    traceparent: formatTraceparent({
      traceId: inbound?.traceId ?? newTraceId(),
      spanId: newSpanId(),
      sampled: inbound?.sampled ?? false,
    }),
  };
}

const storage = new AsyncLocalStorage<Correlation>();

/** Binds a correlation to the current async execution, including across `await`. */
export function runWithCorrelation<T>(correlation: Correlation, fn: () => T): T {
  return storage.run(correlation, fn);
}

export function currentCorrelation(): Correlation | undefined {
  return storage.getStore();
}
