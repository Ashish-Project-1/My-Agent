import { DEVICE_ID_HEADER, DEVICE_SIGNATURE_HEADER, DEVICE_TIMESTAMP_HEADER } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import { signDeviceRequest } from "../src/device-auth.js";
import { generateDeviceKeys } from "../src/keys.js";
import { verifyDeviceSignature } from "./verify.js";

const NOW = new Date("2026-10-18T10:00:00.000Z");
const DEVICE_ID = "018f9c0e-1111-7000-8000-000000000001";
const PATH = "/v1/devices/abc/commands?cursor=0&waitSeconds=1";

describe("device request signing", () => {
  it("signs the canonical string the API verifies, header for header", () => {
    const keys = generateDeviceKeys();
    const headers = signDeviceRequest({
      privateKey: keys.privateKey,
      method: "GET",
      path: PATH,
      body: "",
      deviceId: DEVICE_ID,
      now: NOW,
    });

    expect(headers[DEVICE_ID_HEADER]).toBe(DEVICE_ID);
    expect(headers[DEVICE_TIMESTAMP_HEADER]).toBe("2026-10-18T10:00:00.000Z");
    expect(
      verifyDeviceSignature({
        publicKey: keys.publicKey,
        method: "GET",
        path: PATH,
        timestamp: headers[DEVICE_TIMESTAMP_HEADER] ?? "",
        body: "",
        signature: headers[DEVICE_SIGNATURE_HEADER] ?? "",
      }),
    ).toBe(true);
  });

  it("has no device id while registering: it has not got one yet", () => {
    const keys = generateDeviceKeys();
    const headers = signDeviceRequest({
      privateKey: keys.privateKey,
      method: "POST",
      path: "/v1/devices",
      body: '{"pairingCode":"4K7Q-2M3X"}',
      now: NOW,
    });
    expect(headers[DEVICE_ID_HEADER]).toBeUndefined();
    expect(headers[DEVICE_SIGNATURE_HEADER]).toBeDefined();
  });

  it("covers the body, so a changed payload does not verify", () => {
    const keys = generateDeviceKeys();
    const headers = signDeviceRequest({
      privateKey: keys.privateKey,
      method: "POST",
      path: PATH,
      body: '{"outcome":"acked"}',
      deviceId: DEVICE_ID,
      now: NOW,
    });
    expect(
      verifyDeviceSignature({
        publicKey: keys.publicKey,
        method: "POST",
        path: PATH,
        timestamp: headers[DEVICE_TIMESTAMP_HEADER] ?? "",
        body: '{"outcome":"failed"}',
        signature: headers[DEVICE_SIGNATURE_HEADER] ?? "",
      }),
    ).toBe(false);
  });

  it("covers the query string, so a captured signature cannot be re-aimed", () => {
    const keys = generateDeviceKeys();
    const headers = signDeviceRequest({
      privateKey: keys.privateKey,
      method: "GET",
      path: PATH,
      body: "",
      deviceId: DEVICE_ID,
      now: NOW,
    });
    expect(
      verifyDeviceSignature({
        publicKey: keys.publicKey,
        method: "GET",
        path: "/v1/devices/abc/commands?cursor=99&waitSeconds=1",
        timestamp: headers[DEVICE_TIMESTAMP_HEADER] ?? "",
        body: "",
        signature: headers[DEVICE_SIGNATURE_HEADER] ?? "",
      }),
    ).toBe(false);
  });

  it("signs with the clock it is handed, so replay can be judged", () => {
    const keys = generateDeviceKeys();
    const headers = signDeviceRequest({
      privateKey: keys.privateKey,
      method: "GET",
      path: PATH,
      body: "",
      deviceId: DEVICE_ID,
      now: new Date("2026-10-18T11:00:00.000Z"),
    });
    expect(headers[DEVICE_TIMESTAMP_HEADER]).toBe("2026-10-18T11:00:00.000Z");
  });
});
