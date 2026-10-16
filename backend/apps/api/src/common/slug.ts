import { randomBytes } from "node:crypto";

const MAX_SLUG_LENGTH = 40;

/**
 * A URL-safe identifier for an organization.
 *
 * Non-ASCII is dropped rather than transliterated: a slug is an identifier, and
 * the display name is what carries the meaning (docs/planning/06 §2.1).
 */
export function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");
  return base.length > 0 ? base : "org";
}

const SLUG_ATTEMPTS = 3;

/**
 * Slugs to try, in order: the readable one first, then random ones for the case
 * where it is already taken.
 *
 * A pre-flight "is it free?" check cannot be trusted — another request can take
 * the slug between the check and the insert — so the caller uses these as
 * retries for a unique-constraint violation, which is the only check that holds.
 */
export function slugCandidates(name: string): string[] {
  const base = slugify(name);
  return [
    base,
    ...Array.from({ length: SLUG_ATTEMPTS - 1 }, () => `${base}-${randomBytes(3).toString("hex")}`),
  ];
}
