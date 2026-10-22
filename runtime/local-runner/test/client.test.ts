import { DEVICE_ID_HEADER, DEVICE_SIGNATURE_HEADER, DEVICE_TIMESTAMP_HEADER } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import { ApiError, DeviceClient } from "../src/client.js";
import { generateDeviceKeys } from "../src/keys.js";
import { verifyDeviceSignature } from "./verify.js";

const DEVICE_ID = "018f9c0e-1111-7000-8000-000000000001";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: string | null;
}

/** A stand-in API that records what was actually sent. */
function stubFetch(response: () => Response): { calls: Call[]; fetch: typeof fetch } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: string | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(init?.headers ?? {})) {
      headers[key.toLowerCase()] = String(value);
    }
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers,
      body: typeof init?.body === "string" ? init.body : null,
    });
    return response();
  }) as unknown as typeof fetch;
  return { calls, fetch: fetchImpl };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const device = {
  id: DEVICE_ID,
  ownerUserId: "018f9c0e-2222-7000-8000-000000000002",
  name: "DESKTOP-01",
  os: "win32",
  osVersion: "10.0.26100",
  runnerVersion: "0.1.0",
  status: "pending",
  keyAlgorithm: "ed25519",
  fingerprint: "a".repeat(64),
  capabilities: { commands: ["diagnostics_ping"], playwright: false },
  lastSeenAt: null,
  createdAt: "2026-10-18T10:00:00.000Z",
};

describe("device client", () => {
  it("registers with a signature from the key it is presenting, and no device id", async () => {
    const keys = generateDeviceKeys();
    const { calls, fetch } = stubFetch(() => json(201, { device }));
    const client = new DeviceClient("http://127.0.0.1:3005", fetch);

    const registered = await client.register({
      pairingCode: "4K7Q-2M3X",
      name: "DESKTOP-01",
      os: "win32",
      osVersion: "10.0.26100",
      runnerVersion: "0.1.0",
      keys,
      capabilities: { commands: ["diagnostics_ping"] },
    });

    expect(registered.id).toBe(DEVICE_ID);
    const call = calls[0];
    expect(call?.url).toBe("http://127.0.0.1:3005/v1/devices");
    expect(call?.method).toBe("POST");
    expect(call?.headers[DEVICE_ID_HEADER]).toBeUndefined();
    expect(call?.headers[DEVICE_SIGNATURE_HEADER]).toBeDefined();
    expect(
      verifyDeviceSignature({
        publicKey: keys.publicKey,
        method: "POST",
        path: "/v1/devices",
        timestamp: call?.headers[DEVICE_TIMESTAMP_HEADER] ?? "",
        body: call?.body ?? "",
        signature: call?.headers[DEVICE_SIGNATURE_HEADER] ?? "",
      }),
    ).toBe(true);
  });

  it("signs the path it actually requests, query string included", async () => {
    const keys = generateDeviceKeys();
    const { calls, fetch } = stubFetch(() => json(200, { commands: [], cursor: 7 }));
    const client = new DeviceClient("http://127.0.0.1:3005", fetch);
    const credentials = { deviceId: DEVICE_ID, privateKey: keys.privateKey };

    const batch = await client.poll(credentials, 7, 25);

    expect(batch).toEqual({ commands: [], cursor: 7 });
    const call = calls[0];
    expect(call?.url).toBe(
      `http://127.0.0.1:3005/v1/devices/${DEVICE_ID}/commands?cursor=7&waitSeconds=25`,
    );
    expect(call?.headers[DEVICE_ID_HEADER]).toBe(DEVICE_ID);
    expect(
      verifyDeviceSignature({
        publicKey: keys.publicKey,
        method: "GET",
        path: `/v1/devices/${DEVICE_ID}/commands?cursor=7&waitSeconds=25`,
        timestamp: call?.headers[DEVICE_TIMESTAMP_HEADER] ?? "",
        body: "",
        signature: call?.headers[DEVICE_SIGNATURE_HEADER] ?? "",
      }),
    ).toBe(true);
  });

  it("carries the API's error code, so the caller can tell refusal from failure", async () => {
    const keys = generateDeviceKeys();
    const { fetch } = stubFetch(() =>
      json(401, { code: "unauthenticated", detail: "This request is not signed." }),
    );
    const client = new DeviceClient("http://127.0.0.1:3005", fetch);

    const failure = await client
      .poll({ deviceId: DEVICE_ID, privateKey: keys.privateKey }, 0, 0)
      .then(() => null)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(401);
    expect((failure as ApiError).code).toBe("unauthenticated");
    expect((failure as ApiError).message).toBe("This request is not signed.");
  });

  it("rejects a response that is not the contract rather than passing it on", async () => {
    const keys = generateDeviceKeys();
    const { fetch } = stubFetch(() => json(200, { commands: [], cursor: -1 }));
    const client = new DeviceClient("http://127.0.0.1:3005", fetch);

    await expect(
      client.poll({ deviceId: DEVICE_ID, privateKey: keys.privateKey }, 0, 0),
    ).rejects.toThrow(/unexpected command list/);
  });
});
