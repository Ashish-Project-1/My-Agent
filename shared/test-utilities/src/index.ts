/**
 * `@ua/test-utilities` — the shared test setup that stops every package
 * inventing its own (docs/planning/03 §5.12).
 *
 * Production code never imports this package.
 */

/** Anything that needs the current time takes a `Clock`, so tests can stop it. */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = {
  now: () => new Date(),
};

export interface FrozenClock extends Clock {
  /** Moves the clock forward and returns the new instant. */
  advance(milliseconds: number): Date;
  /** Jumps the clock to an instant. */
  set(instant: Date | string): void;
}

/**
 * A clock that only moves when a test says so. `now()` returns a copy, so a
 * caller cannot reach in and change the clock by mutating the result.
 */
export function frozenClock(start: Date | string): FrozenClock {
  let current = typeof start === "string" ? new Date(start) : new Date(start.getTime());
  if (Number.isNaN(current.getTime())) {
    throw new RangeError(`invalid clock start: ${String(start)}`);
  }

  return {
    now: () => new Date(current.getTime()),
    advance: (milliseconds) => {
      current = new Date(current.getTime() + milliseconds);
      return new Date(current.getTime());
    },
    set: (instant) => {
      const next = typeof instant === "string" ? new Date(instant) : instant;
      if (Number.isNaN(next.getTime())) {
        throw new RangeError(`invalid instant: ${String(instant)}`);
      }
      current = next;
    },
  };
}

/**
 * A deterministic UUIDv7 for fixtures: the same sequence gives the same id on
 * every run and every machine, which is what makes fixture-based assertions
 * comparable. Production ids are random; these are not.
 */
export function fixtureUuid(sequence: number): string {
  if (!Number.isInteger(sequence) || sequence < 0) {
    throw new RangeError(
      `fixture sequence must be a non-negative integer, got ${String(sequence)}`,
    );
  }
  const tail = sequence.toString(16).padStart(12, "0").slice(-12);
  return `018f2b3c-4d5e-7f60-8a1b-${tail}`;
}

/** One tenant's worth of fixture ids. Ids are per-fixture, never shared. */
export interface OrganizationFixture {
  organizationId: string;
  slug: string;
  ownerUserId: string;
  ownerEmail: string;
  workspaceId: string;
  deviceId: string;
}

/**
 * Two independent tenants. Cross-tenant tests must use both: an authorisation
 * rule that only ever sees one organisation is not tested (docs/planning/14).
 *
 * Emails are on `.test`, which can never resolve, so a fixture cannot mail a real
 * person even if a test forgets to stub the mailer.
 */
export const orgA: OrganizationFixture = {
  organizationId: fixtureUuid(1),
  slug: "acme",
  ownerUserId: fixtureUuid(3),
  ownerEmail: "owner@acme.test",
  workspaceId: fixtureUuid(5),
  deviceId: fixtureUuid(7),
};

export const orgB: OrganizationFixture = {
  organizationId: fixtureUuid(2),
  slug: "globex",
  ownerUserId: fixtureUuid(4),
  ownerEmail: "owner@globex.test",
  workspaceId: fixtureUuid(6),
  deviceId: fixtureUuid(8),
};

export const organizations = [orgA, orgB] as const;

/** Every id a fixture owns, for assertions of the "no id leaks between tenants" kind. */
export function fixtureIds(fixture: OrganizationFixture): string[] {
  return [fixture.organizationId, fixture.ownerUserId, fixture.workspaceId, fixture.deviceId];
}
