import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { RELATION_FIELDS, TENANT_MODELS } from "../src/tenant.js";

// Read the schema as text: the Prisma CLI does not export a parser, and pulling
// in @prisma/internals for a handful of assertions is not worth the dependency.
const schema = readFileSync(join(import.meta.dirname, "..", "prisma", "schema.prisma"), "utf8");

// Tables carrying tenant-scoped rows; organizations itself is the tenancy root
// and login_attempts is explicitly not tenant-scoped (docs/planning/06 §2.7, §5).
const tenantTables = [
  "memberships",
  "invitations",
  "sessions",
  "idempotency_keys",
  "audit_events",
  "agent_sessions",
  "tasks",
  "task_steps",
  "task_events",
  "task_checkpoints",
  "devices",
  "device_pairing_codes",
  "device_commands",
  "workspaces",
  "workspace_grants",
  "approval_requests",
  "policy_decisions",
  "outbox",
];

const modelBlock = (model: string): string =>
  schema.split(`model ${model} {`)[1]?.split("\n}")[0] ?? "";

/** A field is a relation if it names another model: `@relation`, or a `[]` list. */
const relationFieldsOf = (model: string): string[] =>
  modelBlock(model)
    .split("\n")
    .map((line) => line.trim())
    .filter(
      (line) =>
        line !== "" &&
        !line.startsWith("@@") &&
        (line.includes("@relation(") || line.endsWith("[]")),
    )
    .map((line) => line.split(/\s+/)[0] ?? "")
    .sort();

describe("prisma schema conventions (docs/planning/06 §1)", () => {
  it("uses uuidv7 primary keys and timestamptz timestamps", () => {
    expect(schema).toContain('@default(dbgenerated("uuidv7()"))');
    expect(schema).toContain("@default(now()) @db.Timestamptz");
    expect(schema).not.toContain("@db.Timestamp(3)");
  });

  it("gives every tenant table an organization_id", () => {
    for (const table of tenantTables) {
      expect(modelBlock(table), `${table} must carry organization_id`).toContain("organization_id");
    }
  });

  it("gives every organization_id a real foreign key", () => {
    // docs/planning/06 §1: real FK constraints, ON DELETE RESTRICT by default. A
    // bare uuid would let a tenant row outlive its organization and dangle.
    for (const table of tenantTables) {
      const fk = modelBlock(table)
        .split("\n")
        .find((line) => /fields:\s*\[organization_id\]/.test(line));
      expect(fk, `${table}.organization_id must be a foreign key`).toBeDefined();
      expect(fk).toContain("onDelete: Restrict");
    }
  });

  it("keeps the tenant scope's model list in step with the schema", () => {
    // A table with organization_id that the scope does not know about is refused
    // at query time rather than leaking, but the API would break silently, so the
    // two lists must agree exactly.
    const tenantOwned = schema
      .split(/^model /m)
      .slice(1)
      .filter((block) => block.includes("organization_id"))
      .map((block) => block.split(/[\s{]/)[0] ?? "")
      .sort();
    expect([...TENANT_MODELS].sort()).toEqual(tenantOwned);
  });

  it("keeps the tenant scope's relation-field map in step with the schema", () => {
    // Relation writes are refused by the scope (src/tenant.ts), so a relation
    // that drifts out of this map stops being refused.
    for (const model of TENANT_MODELS) {
      expect(relationFieldsOf(model), `${model} relation fields`).toEqual(
        [...(RELATION_FIELDS[model] ?? [])].sort(),
      );
    }
  });

  it("keeps credential columns confined to the tables that need them", () => {
    const holders = schema
      .split(/^model /m)
      .filter((block) => /password_hash|_enc\b|token_hash/.test(block))
      .map((block) => block.split(/[\s{]/)[0]);
    expect(new Set(holders)).toEqual(
      new Set([
        "users",
        "sessions",
        "invitations",
        "refresh_tokens",
        "task_checkpoints",
        "approval_grants",
      ]),
    );
  });

  it("only cascades a pure child, never a tenancy-root foreign key", () => {
    // Cascade is sanctioned only for pure children (docs/planning/06 §1).
    // refresh_tokens are meaningless without their session; task_steps/events/checkpoints
    // are pure children of tasks; device_commands are delivery records that mean
    // nothing without the device they were queued for; a workspace is a
    // registration of a directory *on* a device, and a grant of a workspace.
    // An approval or a policy decision explains one step of one task and dies with it.
    const blocks = schema.split(/^model /m).slice(1);
    const cascades = blocks
      .filter((b) => b.includes("onDelete: Cascade"))
      .map((b) => b.split(/[\s{]/)[0]);
    expect(cascades).toEqual([
      "refresh_tokens",
      "task_steps",
      "task_events",
      "task_checkpoints",
      "device_commands",
      "workspaces",
      "workspace_grants",
      "approval_requests",
      "policy_decisions",
    ]);
    expect(schema.match(/onDelete: Restrict/g)?.length ?? 0).toBeGreaterThan(4);
  });
});
