import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import {
  canonicalDeviceRequest,
  DEVICE_SIGNATURE_HEADER,
  DEVICE_SIGNATURE_MAX_AGE_MS,
  DEVICE_TIMESTAMP_HEADER,
} from "@ua/contracts";
import type { FastifyRequest } from "fastify";

/**
 * Device request signing (docs/planning/07 §3.6, `11` §T-DEV).
 *
 * The device never presents a cookie, a bearer token or a shared secret: it
 * signs a short canonical string with an Ed25519 key whose private half never
 * left the machine (FR-DEV-01). The API therefore cannot leak a usable device
 * credential — it only holds a public key — and revocation is immediate, because
 * the check is the device's *status* in the database rather than a token that
 * was already handed out.
 *
 * Replay is bounded by the timestamp: a signed request is only accepted within
 * `DEVICE_SIGNATURE_MAX_AGE_MS` of the server's clock.
 */

/** The body digest both sides sign over. Kept here so the contract stays pure. */
export function bodySha256(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export interface DeviceRequestParts {
  readonly method: string;
  readonly path: string;
  readonly timestamp: string;
  readonly body: string;
  readonly signature: string;
  /** base64 DER SubjectPublicKeyInfo, as stored on the device row. */
  readonly publicKey: string;
  readonly now: Date;
}

export type SignatureCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: "stale" | "bad_key" | "bad_signature" };

/**
 * Returns *why* it failed so the guard can log a useful reason without ever
 * telling the caller which half was wrong.
 */
export function checkDeviceSignature(parts: DeviceRequestParts): SignatureCheck {
  const signedAt = Date.parse(parts.timestamp);
  if (
    Number.isNaN(signedAt) ||
    Math.abs(parts.now.getTime() - signedAt) > DEVICE_SIGNATURE_MAX_AGE_MS
  ) {
    return { ok: false, reason: "stale" };
  }

  const key = publicKeyFrom(parts.publicKey);
  if (key === null) {
    return { ok: false, reason: "bad_key" };
  }

  const canonical = canonicalDeviceRequest({
    method: parts.method,
    path: parts.path,
    timestamp: parts.timestamp,
    bodySha256: bodySha256(parts.body),
  });

  const valid = verifySignature(
    null,
    Buffer.from(canonical, "utf8"),
    key,
    Buffer.from(parts.signature, "base64"),
  );
  return valid ? { ok: true } : { ok: false, reason: "bad_signature" };
}

function publicKeyFrom(encoded: string): ReturnType<typeof createPublicKey> | null {
  try {
    return createPublicKey({
      key: Buffer.from(encoded, "base64"),
      format: "der",
      type: "spki",
    });
  } catch {
    // A malformed or truncated key is a bad request, not a crash.
    return null;
  }
}

export function deviceFingerprint(publicKeyBase64: string): string {
  return createHash("sha256").update(Buffer.from(publicKeyBase64, "base64")).digest("hex");
}

export interface SignedRequestParts {
  readonly method: string;
  readonly path: string;
  readonly timestamp: string | null;
  readonly signature: string | null;
  /**
   * The bytes as they arrived, not a re-serialisation of the parsed body: the
   * signer hashed what it sent, and `JSON.stringify(JSON.parse(x))` is not `x`.
   * Requires `rawBody: true` on the Nest application.
   */
  readonly body: string;
}

/** Both device-facing paths read the same three headers; only the key differs. */
export function signedRequestParts(request: FastifyRequest): SignedRequestParts {
  const raw = (request as FastifyRequest & { rawBody?: Buffer }).rawBody;
  return {
    method: request.method,
    // Includes the query string, so a signed cursor cannot travel to another
    // page of results.
    path: request.url,
    timestamp: single(request.headers[DEVICE_TIMESTAMP_HEADER]),
    signature: single(request.headers[DEVICE_SIGNATURE_HEADER]),
    body: raw === undefined ? "" : raw.toString("utf8"),
  };
}

function single(header: string | string[] | undefined): string | null {
  return typeof header === "string" ? header : null;
}
