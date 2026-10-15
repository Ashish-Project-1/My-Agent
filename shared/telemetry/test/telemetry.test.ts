import { Ulid } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import {
  currentCorrelation,
  formatTraceparent,
  newRequestId,
  newSpanId,
  newTraceId,
  parseTraceparent,
  runWithCorrelation,
  startCorrelation,
} from "../src/index.js";

describe("newRequestId", () => {
  it("produces a ULID that satisfies the contract", () => {
    expect(Ulid.safeParse(newRequestId()).success).toBe(true);
  });

  it("sorts lexicographically by creation time", () => {
    const earlier = newRequestId(1_700_000_000_000);
    const later = newRequestId(1_700_000_001_000);
    expect(earlier < later).toBe(true);
  });

  it("is 26 Crockford base32 characters", () => {
    expect(newRequestId()).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
  });

  it("does not repeat", () => {
    const ids = new Set(Array.from({ length: 500 }, () => newRequestId()));
    expect(ids.size).toBe(500);
  });
});

describe("formatTraceparent", () => {
  it("produces a W3C traceparent", () => {
    const traceparent = formatTraceparent({
      traceId: newTraceId(),
      spanId: newSpanId(),
      sampled: true,
    });
    expect(traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
  });
});

describe("parseTraceparent", () => {
  it("round-trips", () => {
    const original = { traceId: newTraceId(), spanId: newSpanId(), sampled: false };
    expect(parseTraceparent(formatTraceparent(original))).toEqual(original);
  });

  it("reads the sampled flag", () => {
    expect(parseTraceparent(`00-${newTraceId()}-${newSpanId()}-01`)?.sampled).toBe(true);
    expect(parseTraceparent(`00-${newTraceId()}-${newSpanId()}-00`)?.sampled).toBe(false);
  });

  it("rejects a malformed value rather than guessing", () => {
    for (const bad of [
      "",
      "not-a-trace",
      `00-${newTraceId()}-${newSpanId()}`,
      `00-${"z".repeat(32)}-${newSpanId()}-01`,
      `00-${"0".repeat(32)}-${newSpanId()}-01`,
      `00-${newTraceId()}-${"0".repeat(16)}-01`,
    ]) {
      expect(parseTraceparent(bad), bad).toBeUndefined();
    }
  });
});

describe("startCorrelation", () => {
  it("continues an inbound trace and mints a new span", () => {
    const inbound = formatTraceparent({
      traceId: newTraceId(),
      spanId: newSpanId(),
      sampled: true,
    });
    const correlation = startCorrelation(inbound);

    expect(parseTraceparent(correlation.traceparent)?.traceId).toBe(
      parseTraceparent(inbound)?.traceId,
    );
    expect(parseTraceparent(correlation.traceparent)?.spanId).not.toBe(
      parseTraceparent(inbound)?.spanId,
    );
    expect(Ulid.safeParse(correlation.requestId).success).toBe(true);
  });

  it("starts a fresh trace when the inbound value is unusable", () => {
    const correlation = startCorrelation("garbage");
    expect(parseTraceparent(correlation.traceparent)).toBeDefined();
  });

  it("starts a fresh trace when there is no inbound value", () => {
    expect(parseTraceparent(startCorrelation().traceparent)).toBeDefined();
  });
});

describe("runWithCorrelation", () => {
  it("is visible inside the callback, across await, and not outside", async () => {
    const correlation = startCorrelation();

    expect(currentCorrelation()).toBeUndefined();

    const seen = await runWithCorrelation(correlation, async () => {
      await Promise.resolve();
      return currentCorrelation();
    });

    expect(seen).toEqual(correlation);
    expect(currentCorrelation()).toBeUndefined();
  });
});
