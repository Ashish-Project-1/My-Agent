#!/usr/bin/env node
// Scans tracked (or staged) files for anything shaped like a live credential.
//
//   node scripts/scan-secrets.mjs            # tracked files — used by CI
//   node scripts/scan-secrets.mjs --staged   # staged files only — used by the hook
//
// A false positive is accepted with `scan-secrets:allow` on the line, or
// `scan-secrets:allow-file` anywhere in the first 20 lines of the file. Both are
// grep-able, so accepting a finding is a reviewable act rather than a silent one.
//
// This is the second line of defence, not the first: `.gitignore` and a
// passphrase-protected environment are the first.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { ALLOW_FILE_MARKER, findSecrets } from "./lib/secret-patterns.mjs";

const staged = process.argv.includes("--staged");

const MAX_FILE_BYTES = 2_000_000;
const BINARY_EXTENSIONS =
  /\.(?:png|jpe?g|gif|ico|icns|webp|woff2?|ttf|otf|zip|gz|7z|exe|dll|so|dylib|node|pdf|onnx|gguf|safetensors|pt|pth|bin)$/i;

function listFiles() {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "-z"];
  return execFileSync("git", args, { encoding: "utf8" }).split("\0").filter(Boolean);
}

const findings = [];
let scanned = 0;
let allowedFiles = 0;

for (const file of listFiles()) {
  if (BINARY_EXTENSIONS.test(file) || file === "pnpm-lock.yaml") {
    continue;
  }

  let contents;
  try {
    const buffer = readFileSync(file);
    if (buffer.byteLength > MAX_FILE_BYTES || buffer.includes(0)) {
      continue;
    }
    contents = buffer.toString("utf8");
  } catch {
    // Deleted in the working tree, or unreadable: nothing to scan.
    continue;
  }

  scanned += 1;
  const lines = contents.split(/\r?\n/);
  if (lines.slice(0, 20).some((line) => line.includes(ALLOW_FILE_MARKER))) {
    allowedFiles += 1;
    continue;
  }

  lines.forEach((line, index) => {
    for (const rule of findSecrets(line)) {
      findings.push({ file, line: index + 1, rule });
    }
  });
}

for (const finding of findings) {
  console.error(`${finding.file}:${finding.line}: ${finding.rule}`);
}

const scope = staged ? "staged" : "tracked";
if (findings.length > 0) {
  console.error(`\n${findings.length} potential secret(s) in ${scope} files.`);
  console.error(`If a finding is intentional, mark it with \`scan-secrets:allow\` on that line.`);
  process.exit(1);
}

console.log(
  `no secrets found in ${scanned} ${scope} file(s)` +
    (allowedFiles > 0 ? ` (${allowedFiles} file(s) opted out)` : ""),
);
