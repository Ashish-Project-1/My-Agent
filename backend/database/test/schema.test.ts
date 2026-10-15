import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Read the schema as text: the Prisma CLI does not export a parser, and pulling
// in @prisma/internals for a handful of assertions is not worth the dependency.
const schema = readFileSync(join(import.meta.dirname, "..", "prisma", "schema.prisma"), "utf8");

// Tables carrying tenant-scoped rows; organizations itself is the tenancy root
// and login_attempts is explicitly not tenant-scoped (docs/planning/06 §2.7, §5).
const tenantTables = ["memberships", "invitations", "sessions", "idempotency_keys", "audit_events"];

describe("prisma schema conventions (docs/planning/06 §1)", () => {
  it("uses uuidv7 primary keys and timestamptz timestamps", () => {
    expect(schema).toContain('@default(dbgenerated("uuidv7()"))');
    expect(schema).toContain("@default(now()) @db.Timestamptz");
    expect(schema).not.toContain("@db.Timestamp(3)");
  });

  it("gives every tenant table an organization_id", () => {
    for (const table of tenantTables) {
      const block = schema.split(`model ${table} {`)[1]?.split("\n}")[0] ?? "";
      expect(block, `${table} must carry organization_id`).toContain("organization_id");
    }
  });

  it("keeps credential columns confined to the four tables that need them", () => {
    const holders = schema
      .split(/^model /m)
      .filter((block) => /password_hash|_enc\b|token_hash/.test(block))
      .map((block) => block.split(/[\s{]/)[0]);
    expect(new Set(holders)).toEqual(
      new Set(["users", "sessions", "invitations", "refresh_tokens"]),
    );
  });

  it("only cascades a pure child, never a tenancy-root foreign key", () => {
    // Cascade is sanctioned only for pure children (docs/planning/06 §1).
    // refresh_tokens are meaningless without their session; anything hanging
    // off organizations/memberships must not take another tenant's data with it.
    const blocks = schema.split(/^model /m).slice(1);
    const cascades = blocks
      .filter((b) => b.includes("onDelete: Cascade"))
      .map((b) => b.split(/[\s{]/)[0]);
    expect(cascades).toEqual(["refresh_tokens"]);
    expect(schema.match(/onDelete: Restrict/g)?.length ?? 0).toBeGreaterThan(4);
  });
});
