#!/usr/bin/env node
// Module boundaries (docs/planning/03 4, 17 Phase 3).
//
// A NestJS module owns its tables. It may reach any other table only through
// that module's public interface — a service or repository it imports — never
// by querying the model itself.
//
// This is a lint rule rather than a network hop because until a service-splitting
// trigger is met (03 4) every module shares one process and one Prisma client,
// and nothing else stops that shared client from quietly erasing the seam.
//
// What it looks at: `<handle>.<model>.<prismaOperation>`. A Prisma operation is
// the discriminator on purpose — `this.sessions.list(...)` and
// `row.user.memberships.find(...)` are not database access, and a rule that
// flagged them would be disabled within a week.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const API_SRC = fileURLToPath(new URL("../backend/apps/api/src", import.meta.url));
const SCHEMA = fileURLToPath(new URL("../backend/database/prisma/schema.prisma", import.meta.url));

/**
 * Which tables each module owns.
 *
 * `shared` is not a module: it is the write-through plumbing every future module
 * is expected to use (an outbox row, an idempotency key), so touching it is not
 * a boundary crossing. Anything not listed here belongs to exactly one module.
 */
const OWNERSHIP = {
  identity: ["users", "sessions", "refresh_tokens", "login_attempts"],
  organizations: ["organizations", "memberships", "invitations"],
  audit: ["audit_events"],
  tasks: ["tasks", "task_steps", "task_events", "task_checkpoints"],
  "agent-sessions": ["agent_sessions"],
  devices: ["devices", "device_pairing_codes", "device_commands"],
  workspaces: ["workspaces", "workspace_grants"],
};

const SHARED = ["outbox", "idempotency_keys", "job_leases"];

/**
 * Pre-existing crossings, kept out of the way rather than refactored today.
 *
 * Each one is a single transaction that has to span two modules' tables, and
 * each has an intended fix. They are listed here so that the rule still blocks
 * every *new* violation; do not add to this list without a plan to delete from
 * it.
 */
const ALLOWED = [
  {
    file: "identity/identity.repository.ts",
    models: ["organizations", "memberships"],
    reason: "registration creates the first organization and its membership",
  },
  {
    file: "tasks/tasks.repository.ts",
    models: ["agent_sessions"],
    reason: "task creation opens an agent session in the same transaction",
  },
];

const PRISMA_OPERATIONS = [
  "findMany",
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "create",
  "createMany",
  "createManyAndReturn",
  "update",
  "updateMany",
  "updateManyAndReturn",
  "upsert",
  "delete",
  "deleteMany",
  "count",
  "aggregate",
  "groupBy",
];

/** `<anything>.<model>.<prismaOperation>` — see the note at the top of the file. */
const ACCESS = new RegExp(`\\.([a-z_]+)\\.(${PRISMA_OPERATIONS.join("|")})\\b`, "g");

function schemaModels() {
  return new Set(
    [...readFileSync(SCHEMA, "utf8").matchAll(/^model\s+(\w+)\s+\{/gm)].map((match) => match[1]),
  );
}

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : path.endsWith(".ts") ? [path] : [];
  });
}

const models = schemaModels();
if (models.size === 0) {
  console.error("no Prisma models found in the schema; refusing to pass on a technicality");
  process.exit(1);
}

const known = new Set([...models].filter((model) => !SHARED.includes(model)));
const owned = new Map();
for (const [module, tables] of Object.entries(OWNERSHIP)) {
  for (const table of tables) {
    if (!known.has(table)) {
      console.error(`ownership map names ${table}, which is not a model in the schema`);
      process.exit(1);
    }
    if (owned.has(table)) {
      console.error(`ownership map gives ${table} to both ${owned.get(table)} and ${module}`);
      process.exit(1);
    }
    owned.set(table, module);
  }
}

const problems = [];

for (const file of sourceFiles(API_SRC)) {
  // `src/<module>/<file>`: the first directory under src/ is the module. Paths
  // are normalised to `/` so the exception list reads the same on Windows.
  const relativePath = relative(API_SRC, file).split(sep).join("/");
  const segments = relativePath.split("/");
  const module = segments.length > 1 ? segments[0] : "(app root)";
  const allowedHere = new Set(
    ALLOWED.flatMap((entry) => (entry.file === relativePath ? entry.models : [])),
  );

  readFileSync(file, "utf8")
    .split(/\r?\n/)
    .forEach((line, index) => {
      if (line.trimStart().startsWith("//")) {
        return;
      }
      for (const [, table] of line.matchAll(ACCESS)) {
        if (!known.has(table) || SHARED.includes(table) || allowedHere.has(table)) {
          continue;
        }
        const owner = owned.get(table);
        if (owner === undefined || owner === module || module === "(app root)") {
          continue;
        }
        problems.push({
          where: `${relative(process.cwd(), file)}:${index + 1}`,
          module,
          table,
          owner,
        });
      }
    });
}

if (problems.length > 0) {
  console.error(`${problems.length} cross-module table access(es):\n`);
  for (const problem of problems) {
    console.error(
      `  ${problem.where}\n    ${problem.module} reads ${problem.table}, owned by ${problem.owner}.\n    Import that module's service instead of its table.\n`,
    );
  }
  process.exit(1);
}

console.log(
  `module boundaries hold: ${owned.size} tables owned across ${Object.keys(OWNERSHIP).length} modules, ${ALLOWED.length} documented exception(s)`,
);
