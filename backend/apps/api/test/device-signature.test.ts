import { createHash, generateKeyPairSync, sign as signEd25519 } from "node:crypto";
import { canonicalDeviceRequest, DEVICE_SIGNATURE_MAX_AGE_MS } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import {
  bodySha256,
  checkDeviceSignature,
  deviceFingerprint,
} from "../src/devices/device-signature.js";

/** One device key, reused: the maths is not what varies between these cases. */
const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const SPKI = publicKey.export({ format: "der", type: "spki" }).toString("base64");
const NOW = new Date("2026-10-18T10:00:00.000Z");

function signedRequest(
  overrides: { method?: string; path?: string; timestamp?: string; body?: string } = {},
): {
  method: string;
  path: string;
  timestamp: string;
  body: string;
  signature: string;
  publicKey: string;
  now: Date;
} {
  const method = overrides.method ?? "POST";
  const path =
    overrides.path ?? "/v1/devices/018f9c0e-1111-7000-8000-000000000001/commands/aaa/ack";
  const timestamp = overrides.timestamp ?? NOW.toISOString();
  const body = overrides.body ?? '{"outcome":"acked"}';
  const canonical = canonicalDeviceRequest({
    method,
    path,
    timestamp,
    bodySha256: bodySha256(body),
  });
  return {
    method,
    path,
    timestamp,
    body,
    publicKey: SPKI,
    now: NOW,
    signature: signEd25519(null, Buffer.from(canonical, "utf8"), privateKey).toString("base64"),
  };
}

describe("device request signatures", () => {
  it("accepts a request it just signed", () => {
    expect(checkDeviceSignature(signedRequest())).toEqual({ ok: true });
  });

  it("digests the exact bytes, so a reserialised body does not verify", () => {
    const check = checkDeviceSignature({
      ...signedRequest(),
      body: '{"outcome": "acked"}',
    });
    expect(check).toEqual({ ok: false, reason: "bad_signature" });
  });

  it("rejects a signature made by a different key", () => {
    const other = generateKeyPairSync("ed25519");
    const spki = other.publicKey.export({ format: "der", type: "spki" }).toString("base64");
    expect(checkDeviceSignature({ ...signedRequest(), publicKey: spki })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("tolerates clock drift up to the replay window, and no further", () => {
    const inside = new Date(NOW.getTime() - DEVICE_SIGNATURE_MAX_AGE_MS + 1000).toISOString();
    const outside = new Date(NOW.getTime() - DEVICE_SIGNATURE_MAX_AGE_MS - 1000).toISOString();
    expect(checkDeviceSignature(signedRequest({ timestamp: inside }))).toEqual({ ok: true });
    expect(checkDeviceSignature(signedRequest({ timestamp: outside }))).toEqual({
      ok: false,
      reason: "stale",
    });
  });

  it("covers the method and the path, so one request's signature is not another's", () => {
    const request = signedRequest();
    expect(checkDeviceSignature({ ...request, method: "GET" })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
    expect(checkDeviceSignature({ ...request, path: `${request.path}?cursor=9` })).toEqual({
      ok: false,
      reason: "bad_signature",
    });
  });

  it("says 'stale' before touching a key, so a clock problem reads as one", () => {
    expect(
      checkDeviceSignature({
        ...signedRequest({ timestamp: outsideWindow() }),
        publicKey: "not base64 at all",
      }),
    ).toEqual({ ok: false, reason: "stale" });
  });

  it("reports an unusable public key rather than throwing", () => {
    expect(checkDeviceSignature({ ...signedRequest(), publicKey: "AAAA" })).toEqual({
      ok: false,
      reason: "bad_key",
    });
  });

  it("is the same digest the device computes, over the DER bytes", () => {
    expect(deviceFingerprint(SPKI)).toBe(
      createHash("sha256").update(Buffer.from(SPKI, "base64")).digest("hex"),
    );
    expect(bodySha256("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
  });
});

function outsideWindow(): string {
  return new Date(NOW.getTime() - DEVICE_SIGNATURE_MAX_AGE_MS - 1000).toISOString();
}
