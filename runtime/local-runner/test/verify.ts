import { createHash, createPublicKey, verify } from "node:crypto";
import { canonicalDeviceRequest } from "@ua/contracts";

/**
 * An independent verifier for the runner's signatures.
 *
 * It shares only the canonical *format* with the signer (through
 * `@ua/contracts`, the same function the API verifies with) and wires the
 * crypto itself, so a signer and verifier that share a mistake cannot agree
 * with each other while failing against the API.
 */
export function verifyDeviceSignature(input: {
  publicKey: string;
  method: string;
  path: string;
  timestamp: string;
  body: string;
  signature: string;
}): boolean {
  const canonical = canonicalDeviceRequest({
    method: input.method,
    path: input.path,
    timestamp: input.timestamp,
    bodySha256: createHash("sha256").update(input.body, "utf8").digest("hex"),
  });
  return verify(
    null,
    Buffer.from(canonical, "utf8"),
    createPublicKey({ key: Buffer.from(input.publicKey, "base64"), format: "der", type: "spki" }),
    Buffer.from(input.signature, "base64"),
  );
}
