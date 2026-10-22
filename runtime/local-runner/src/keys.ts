import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync } from "node:crypto";

/**
 * The device's identity: an Ed25519 keypair, held only on this machine
 * (FR-DEV-01, docs/planning/11 §T-DEV).
 *
 * The API is given the public half and nothing else, which is the reason
 * revoking a device works instantly — there is no credential of ours left in
 * its hands to expire. Keys are stored as DER in base64, the form
 * `KeyObject.export` produces and the form the contract expects, so nothing
 * re-encodes them.
 */
export interface DeviceKeys {
  /** base64 DER SubjectPublicKeyInfo. */
  readonly publicKey: string;
  /** base64 DER PKCS#8. Never leaves this machine. */
  readonly privateKey: string;
  /** SHA-256 of the public key bytes, hex — what a human compares with the browser. */
  readonly fingerprint: string;
}

/** The same digest the API computes, over the decoded key bytes rather than the text. */
export function fingerprintOf(publicKeyBase64: string): string {
  return createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest("hex");
}

export function generateDeviceKeys(): DeviceKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return {
    publicKey: spki,
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    fingerprint: fingerprintOf(spki),
  };
}

/** Recover the public half from the stored private key, so the two are never stored out of step. */
export function publicKeyOf(privateKeyBase64: string): string {
  const privateKey = createPrivateKey({
    key: Buffer.from(privateKeyBase64, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return createPublicKey(privateKey).export({ format: "der", type: "spki" }).toString("base64");
}
