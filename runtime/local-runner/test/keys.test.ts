import { describe, expect, it } from "vitest";
import { fingerprintOf, generateDeviceKeys, publicKeyOf } from "../src/keys.js";

describe("device keys", () => {
  it("fingerprints the public key with the digest the API computes", () => {
    const keys = generateDeviceKeys();
    expect(keys.fingerprint).toBe(fingerprintOf(keys.publicKey));
    expect(keys.fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("recovers the public half from the stored private key", () => {
    const keys = generateDeviceKeys();
    expect(publicKeyOf(keys.privateKey)).toBe(keys.publicKey);
  });

  it("gives every machine a different key", () => {
    expect(generateDeviceKeys().publicKey).not.toBe(generateDeviceKeys().publicKey);
  });

  it("exports a key the contract accepts", () => {
    const { publicKey } = generateDeviceKeys();
    expect(Buffer.from(publicKey, "base64").toString("base64")).toBe(publicKey);
  });
});
