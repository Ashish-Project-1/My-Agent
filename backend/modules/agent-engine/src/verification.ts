import { canonicalJson } from "@ua/contracts";
import { sha256Hex } from "./action.js";

/**
 * Verification of one tool result (docs/planning/08 §10, FR-TASK-07).
 *
 * The device reports what it wrote; the worker checks it against the action it
 * approved. Nothing here trusts the report: the result digest must recompute,
 * the reported path must be the requested path, and the reported content hash
 * and byte count must match the arguments the user approved.
 *
 * `shortcut: this is the device's attested write, not an independent read-back.
 * A read-back needs a second tool and a second approval; it arrives with the
 * workspace read tool in Phase 6.`
 */
export interface ResultCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface VerificationOutcome {
  readonly passed: boolean;
  readonly checks: readonly ResultCheck[];
}

export interface ReportedToolResult {
  readonly payload: Record<string, unknown>;
  readonly digest: string;
}

export function verifyToolResult(input: {
  tool: string;
  arguments: Record<string, unknown>;
  result: ReportedToolResult;
}): VerificationOutcome {
  const checks: ResultCheck[] = [];

  const recomputed = sha256Hex(canonicalJson(input.result.payload));
  checks.push({
    name: "result.digest",
    passed: recomputed === input.result.digest,
    detail: recomputed === input.result.digest ? "matches the reported payload" : "does not match",
  });

  if (input.tool === "workspace.write_file") {
    const requestedPath = input.arguments.path;
    const content = typeof input.arguments.content === "string" ? input.arguments.content : "";

    checks.push({
      name: "result.path",
      passed: input.result.payload.path === requestedPath,
      detail: input.result.payload.path === requestedPath ? "same path" : "a different path",
    });

    const contentDigest = sha256Hex(content);
    checks.push({
      name: "result.content",
      passed: input.result.payload.sha256 === contentDigest,
      detail:
        input.result.payload.sha256 === contentDigest
          ? "the approved bytes"
          : "the device reported different bytes",
    });

    const bytes = Buffer.byteLength(content, "utf8");
    checks.push({
      name: "result.bytes",
      passed: input.result.payload.bytes === bytes,
      detail: input.result.payload.bytes === bytes ? `${bytes} bytes` : "byte count differs",
    });
  }

  return { passed: checks.every((check) => check.passed), checks };
}
