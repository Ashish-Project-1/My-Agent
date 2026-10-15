#!/usr/bin/env node
// Generates backend/contracts/openapi.json from the Zod schemas in src/.
//
// Zod is the single source of truth (docs/planning/03 §5.8); this script only
// reshapes it. OpenAPI 3.1 uses JSON Schema 2020-12, so the mapping is direct.
//
// Run via `pnpm --filter @ua/contracts generate:openapi` (builds first).
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { SCHEMAS } from "../dist/registry.js";

const here = dirname(fileURLToPath(import.meta.url));
const outFile = join(here, "..", "openapi.json");

const schemas = {};
const failures = [];
for (const [name, schema] of Object.entries(SCHEMAS)) {
  try {
    schemas[name] = z.toJSONSchema(schema, { target: "draft-2020-12", io: "input" });
  } catch (error) {
    failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Fail loudly rather than publishing a document with holes in it.
if (failures.length > 0) {
  console.error(`unrepresentable schemas:\n  ${failures.join("\n  ")}`);
  process.exit(1);
}

const document = {
  openapi: "3.1.0",
  info: {
    title: "Universal Agent API",
    version: "0.0.0",
    description:
      "Generated from @ua/contracts by scripts/generate-openapi.mjs. Do not edit by hand.",
  },
  paths: {},
  components: { schemas },
};

writeFileSync(outFile, `${JSON.stringify(document, null, 2)}\n`, "utf8");
console.log(`wrote ${outFile} (${Object.keys(schemas).length} schemas)`);
