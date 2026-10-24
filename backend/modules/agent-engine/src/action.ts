import { createHash } from "node:crypto";
import { canonicalToolAction } from "@ua/contracts";

/** Lowercase sha256 of a UTF-8 string — the one hashing form used for digests. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * The digest an approval is bound to (docs/planning/10 §4, FR-APPR-03).
 *
 * Expiry is a parameter rather than `now` on purpose: the same action approved
 * for a different deadline is a different grant, so a decision cannot be
 * stretched by editing a row.
 */
export function actionDigest(input: {
  tool: string;
  toolVersion: string;
  arguments: Record<string, unknown>;
  deviceId: string;
  workspaceId: string;
  policyVersion: string;
  expiresAt: string;
}): string {
  return sha256Hex(canonicalToolAction(input));
}
