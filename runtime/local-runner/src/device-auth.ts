import { createHash, createPrivateKey, sign as signEd25519 } from "node:crypto";
import {
  canonicalDeviceRequest,
  DEVICE_ID_HEADER,
  DEVICE_SIGNATURE_HEADER,
  DEVICE_TIMESTAMP_HEADER,
} from "@ua/contracts";

/**
 * Signing a request the API will accept (docs/planning/07 §3.6).
 *
 * The canonical string comes from `@ua/contracts`, so this side and the
 * verifier cannot drift apart in what gets signed; only the Ed25519 call is
 * local. There is no shared secret anywhere in the flow.
 */

/** SHA-256 of the body's exact bytes — the same bytes that are sent, never a re-serialisation. */
export function bodyDigest(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export interface SignedRequestInput {
  readonly privateKey: string;
  readonly method: string;
  /** The path exactly as it will be sent, query string included. */
  readonly path: string;
  readonly body: string;
  /** Absent while registering: the device has no id yet, and the key is in the body. */
  readonly deviceId?: string;
  readonly now?: Date;
}

export function signDeviceRequest(input: SignedRequestInput): Record<string, string> {
  const timestamp = (input.now ?? new Date()).toISOString();
  const canonical = canonicalDeviceRequest({
    method: input.method,
    path: input.path,
    timestamp,
    bodySha256: bodyDigest(input.body),
  });

  const key = createPrivateKey({
    key: Buffer.from(input.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const signature = signEd25519(null, Buffer.from(canonical, "utf8"), key).toString("base64");

  return {
    ...(input.deviceId === undefined ? {} : { [DEVICE_ID_HEADER]: input.deviceId }),
    [DEVICE_TIMESTAMP_HEADER]: timestamp,
    [DEVICE_SIGNATURE_HEADER]: signature,
  };
}
