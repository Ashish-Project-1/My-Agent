import { describe, expect, it } from "vitest";
import { IdempotencyKey, Money, PaginationQuery, Timestamp, Ulid, Uuid } from "../src/index.js";

/** A real UUIDv7 (version nibble 7, RFC variant) and a valid UUIDv4 for contrast. */
const UUID_V7 = "018f2b3c-4d5e-7f60-8a1b-2c3d4e5f6071";
const UUID_V4 = "9f4b2c1d-3e5a-4b7c-8d9e-0f1a2b3c4d5e";
const ULID = "01J9Z8QK5M7N0P1R2S3T4V5W6X";

describe("Uuid", () => {
  it("accepts a UUIDv7", () => {
    expect(Uuid.safeParse(UUID_V7).success).toBe(true);
  });

  it("rejects a UUIDv4: ids are minted as v7 only", () => {
    expect(Uuid.safeParse(UUID_V4).success).toBe(false);
  });

  it("rejects a non-uuid string", () => {
    expect(Uuid.safeParse("not-an-id").success).toBe(false);
  });
});

describe("Ulid", () => {
  it("accepts a Crockford base32 ULID", () => {
    expect(Ulid.safeParse(ULID).success).toBe(true);
  });

  it("rejects a ULID containing an excluded letter (I, L, O, U)", () => {
    expect(Ulid.safeParse("01J9Z8QK5M7N0P1R2S3T4V5W6I").success).toBe(false);
  });
});

describe("IdempotencyKey", () => {
  it("accepts either a ULID or a UUIDv7", () => {
    expect(IdempotencyKey.safeParse(ULID).success).toBe(true);
    expect(IdempotencyKey.safeParse(UUID_V7).success).toBe(true);
  });

  it("rejects an arbitrary token", () => {
    expect(IdempotencyKey.safeParse("retry-please").success).toBe(false);
  });
});

describe("Timestamp", () => {
  it("accepts ISO 8601 UTC with milliseconds", () => {
    expect(Timestamp.safeParse("2026-10-15T09:30:00.123Z").success).toBe(true);
  });

  it("rejects a timestamp without milliseconds", () => {
    expect(Timestamp.safeParse("2026-10-15T09:30:00Z").success).toBe(false);
  });

  it("rejects a numeric offset instead of UTC", () => {
    expect(Timestamp.safeParse("2026-10-15T09:30:00.123+02:00").success).toBe(false);
  });
});

describe("Money", () => {
  it("accepts minor units plus a currency code", () => {
    expect(Money.safeParse({ amountMinor: 1250, currency: "USD" }).success).toBe(true);
  });

  it("rejects a fractional minor amount", () => {
    expect(Money.safeParse({ amountMinor: 12.5, currency: "USD" }).success).toBe(false);
  });

  it("rejects a lowercase currency code", () => {
    expect(Money.safeParse({ amountMinor: 1250, currency: "usd" }).success).toBe(false);
  });

  it("rejects unknown properties", () => {
    expect(Money.safeParse({ amountMinor: 1250, currency: "USD", note: "x" }).success).toBe(false);
  });
});

describe("PaginationQuery", () => {
  it("defaults to 25", () => {
    expect(PaginationQuery.parse({})).toEqual({ limit: 25 });
  });

  it("coerces a numeric string from the query string", () => {
    expect(PaginationQuery.parse({ limit: "50" }).limit).toBe(50);
  });

  it("rejects a limit above 100", () => {
    expect(PaginationQuery.safeParse({ limit: "500" }).success).toBe(false);
  });

  it("rejects a zero limit", () => {
    expect(PaginationQuery.safeParse({ limit: 0 }).success).toBe(false);
  });

  it("rejects an unknown query parameter instead of ignoring it", () => {
    expect(PaginationQuery.safeParse({ offset: 20 }).success).toBe(false);
  });
});
