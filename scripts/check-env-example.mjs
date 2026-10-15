#!/usr/bin/env node
// Keeps committed `*.env*.example` files honest (docs/planning/15 §6).
//
// Checks every tracked example env file for:
//   1. a parseable `KEY=value` line,
//   2. an UPPER_SNAKE key,
//   3. no key declared twice,
//   4. no value that is actually a live credential.
//
// Rule 4 is the reason this exists: an example file is the one env file that is
// always committed, so it is the easiest place to leak a real key by accident.
//
// Not yet checked: whether every variable the runtime reads is documented. That
// needs the startup config schema, which arrives in Phase 2.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { findSecrets } from "./lib/secret-patterns.mjs";

const KEY_PATTERN = /^[A-Z][A-Z0-9_]*$/;

function exampleFiles() {
  return execFileSync("git", ["ls-files", "-z"], { encoding: "utf8" })
    .split("\0")
    .filter((file) => /(?:^|\/)\.env[^/]*\.example$/.test(file));
}

const files = exampleFiles();
if (files.length === 0) {
  console.error("no .env*.example file is tracked");
  process.exit(1);
}

const problems = [];

for (const file of files) {
  const contents = readFileSync(file, "utf8");
  const seen = new Map();

  contents.split(/\r?\n/).forEach((rawLine, index) => {
    const line = rawLine.trim();
    const where = `${file}:${index + 1}`;

    if (line === "" || line.startsWith("#")) {
      return;
    }

    const separator = line.indexOf("=");
    if (separator < 0) {
      problems.push(`${where}: not a KEY=value line`);
      return;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();

    if (!KEY_PATTERN.test(key)) {
      problems.push(`${where}: key "${key}" is not UPPER_SNAKE_CASE`);
      return;
    }

    if (seen.has(key)) {
      problems.push(`${where}: key "${key}" is already declared on line ${seen.get(key)}`);
      return;
    }
    seen.set(key, index + 1);

    for (const rule of findSecrets(value)) {
      problems.push(
        `${where}: ${key} looks like a real credential (${rule}) — leave example values empty`,
      );
    }
  });
}

for (const problem of problems) {
  console.error(problem);
}

if (problems.length > 0) {
  process.exit(1);
}

console.log(`checked ${files.length} example env file(s): ${files.join(", ")}`);
