import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Enforces ADR-008: the **unscoped** Prisma client may only be reached from the
 * few modules that run before a tenant is known. Everything else must go through
 * `forOrganization`, so an accidental tenant-data leak has to break this test
 * rather than reach production unnoticed (docs/planning/07 §1).
 */
const ALLOWED_PREFIXES = [
  "database", // the definition itself and the module that provides it
  "identity",
  "auth",
  "organizations",
  "audit",
  "health", // the /readyz connection probe reads no tenant rows
];

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      return sourceFiles(full);
    }
    return entry.endsWith(".ts") ? [full] : [];
  });
}

describe("unscoped Prisma client boundary", () => {
  it("is only imported from the modules allowed to run without a tenant", () => {
    const offenders: string[] = [];

    for (const file of sourceFiles(SRC)) {
      if (!readFileSync(file, "utf8").includes("UnscopedDatabase")) {
        continue;
      }
      const modulePath = relative(SRC, file).split(sep).join("/");
      const allowed = ALLOWED_PREFIXES.some(
        (prefix) => modulePath === `${prefix}.ts` || modulePath.startsWith(`${prefix}/`),
      );
      if (!allowed) {
        offenders.push(modulePath);
      }
    }

    expect(offenders).toEqual([]);
  });
});
