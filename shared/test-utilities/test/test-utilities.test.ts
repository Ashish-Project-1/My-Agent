import { Uuid } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import {
  fixtureIds,
  fixtureUuid,
  frozenClock,
  orgA,
  organizations,
  orgB,
  systemClock,
} from "../src/index.js";

describe("frozenClock", () => {
  it("does not move on its own", () => {
    const clock = frozenClock("2026-10-15T09:30:00.000Z");
    expect(clock.now().toISOString()).toBe("2026-10-15T09:30:00.000Z");
    expect(clock.now().toISOString()).toBe(clock.now().toISOString());
  });

  it("advances only by the requested amount", () => {
    const clock = frozenClock("2026-10-15T09:30:00.000Z");
    clock.advance(2500);
    expect(clock.now().toISOString()).toBe("2026-10-15T09:30:02.500Z");
  });

  it("can jump to an instant", () => {
    const clock = frozenClock("2026-10-15T09:30:00.000Z");
    clock.set("2027-01-01T00:00:00.000Z");
    expect(clock.now().toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("hands out copies, so a caller cannot move the clock by mutation", () => {
    const clock = frozenClock("2026-10-15T09:30:00.000Z");
    clock.now().setFullYear(1999);
    expect(clock.now().toISOString()).toBe("2026-10-15T09:30:00.000Z");
  });

  it("refuses an unparseable start", () => {
    expect(() => frozenClock("not a date")).toThrow(RangeError);
  });
});

describe("systemClock", () => {
  it("returns a real instant", () => {
    expect(Math.abs(systemClock.now().getTime() - Date.now())).toBeLessThan(5000);
  });
});

describe("fixtureUuid", () => {
  it("produces an id the contract accepts as a UUIDv7", () => {
    for (const sequence of [0, 1, 42, 1_000_000]) {
      expect(Uuid.safeParse(fixtureUuid(sequence)).success, String(sequence)).toBe(true);
    }
  });

  it("is deterministic", () => {
    expect(fixtureUuid(7)).toBe(fixtureUuid(7));
  });

  it("differs per sequence", () => {
    expect(fixtureUuid(7)).not.toBe(fixtureUuid(8));
  });

  it("refuses a negative or fractional sequence", () => {
    expect(() => fixtureUuid(-1)).toThrow(RangeError);
    expect(() => fixtureUuid(1.5)).toThrow(RangeError);
  });
});

describe("organization fixtures", () => {
  it("gives every fixture id a valid UUIDv7", () => {
    for (const fixture of organizations) {
      for (const id of fixtureIds(fixture)) {
        expect(Uuid.safeParse(id).success, id).toBe(true);
      }
    }
  });

  it("shares no id between the two tenants", () => {
    const first = new Set(fixtureIds(orgA));
    for (const id of fixtureIds(orgB)) {
      expect(first.has(id), id).toBe(false);
    }
  });

  it("uses a non-routable email domain", () => {
    for (const fixture of organizations) {
      expect(fixture.ownerEmail.endsWith(".test")).toBe(true);
    }
  });
});
