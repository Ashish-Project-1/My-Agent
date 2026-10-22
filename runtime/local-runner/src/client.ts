import {
  type AckDeviceCommandRequest,
  AckDeviceCommandRequest as AckDeviceCommandRequestSchema,
  type DeviceCapabilities,
  DeviceCommandListResponse,
  type DeviceSummary,
  DeviceWorkspacePolicy,
  RegisterDeviceRequest,
  RegisterDeviceResponse,
} from "@ua/contracts";
import type { z } from "zod";
import { signDeviceRequest } from "./device-auth.js";
import type { DeviceKeys } from "./keys.js";

/**
 * The device's side of the API (docs/planning/07 §3.6).
 *
 * Every call here is signed with the key on disk; the client holds no token, so
 * there is nothing to refresh and nothing a stolen API dump could replay. A
 * failing response becomes an `ApiError` carrying the API's own error `code`,
 * so the caller can tell "not approved yet" from "revoked" from "network".
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export interface DeviceCredentials {
  readonly deviceId: string;
  readonly privateKey: string;
}

export interface RegisterInput {
  readonly pairingCode: string;
  readonly name: string;
  readonly os: string;
  readonly osVersion: string | null;
  readonly runnerVersion: string;
  readonly keys: DeviceKeys;
  readonly capabilities: DeviceCapabilities;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

function parseContract<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `the API sent an unexpected ${what}: ${parsed.error.issues[0]?.message ?? "invalid"}`,
    );
  }
  return parsed.data;
}

export class DeviceClient {
  constructor(
    private readonly apiOrigin: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  /**
   * One signed call.
   *
   * The signed path is taken from the URL that is actually requested, so no
   * normalisation inside `URL` can make the signature cover a different string
   * from the one on the wire.
   */
  private async send(
    credentials: { deviceId?: string; privateKey: string } | null,
    method: string,
    path: string,
    body: string | null,
  ): Promise<Response> {
    const url = new URL(path, this.apiOrigin);
    const headers: Record<string, string> = { accept: "application/json" };
    if (body !== null) {
      headers["content-type"] = "application/json";
    }
    if (credentials !== null) {
      Object.assign(
        headers,
        signDeviceRequest({
          ...credentials,
          method,
          path: `${url.pathname}${url.search}`,
          body: body ?? "",
        }),
      );
    }
    return this.fetchImpl(url, { method, headers, ...(body === null ? {} : { body }) });
  }

  /** The failure body is read loosely: a proxy error is not our problem shape. */
  private async fail(response: Response): Promise<never> {
    const problem: unknown = await response.json().catch(() => null);
    const record =
      typeof problem === "object" && problem !== null ? (problem as Record<string, unknown>) : {};
    throw new ApiError(
      response.status,
      typeof record.code === "string" ? record.code : "http_error",
      typeof record.detail === "string" ? record.detail : `HTTP ${response.status}`,
    );
  }

  /**
   * Register this machine for approval (FR-DEV-01).
   *
   * The request is signed with the key it is presenting, which is what proves
   * the private half exists; the pairing code is what proves a member of the
   * organization asked for it. Input is validated before it is sent, so a
   * mistyped code reads as a local error rather than a 400 from the API.
   */
  async register(input: RegisterInput): Promise<DeviceSummary> {
    const request = parseContract(
      RegisterDeviceRequest,
      {
        pairingCode: input.pairingCode,
        name: input.name,
        os: input.os,
        osVersion: input.osVersion,
        runnerVersion: input.runnerVersion,
        publicKey: input.keys.publicKey,
        keyAlgorithm: "ed25519",
        fingerprint: input.keys.fingerprint,
        capabilities: input.capabilities,
      },
      "registration request",
    );

    const response = await this.send(
      { privateKey: input.keys.privateKey },
      "POST",
      "/v1/devices",
      JSON.stringify(request),
    );
    if (!response.ok) {
      await this.fail(response);
    }
    return parseContract(RegisterDeviceResponse, await response.json(), "registration response")
      .device;
  }

  /**
   * Long-poll for commands. `waitSeconds: 0` returns immediately, which is also
   * how a pending device checks whether it has been approved yet: until then
   * the answer is 401, because a device that is not `active` is not a device.
   */
  async poll(
    credentials: DeviceCredentials,
    cursor: number,
    waitSeconds: number,
  ): Promise<DeviceCommandListResponse> {
    const path = `/v1/devices/${credentials.deviceId}/commands?cursor=${cursor}&waitSeconds=${waitSeconds}`;
    const response = await this.send(credentials, "GET", path, null);
    if (!response.ok) {
      await this.fail(response);
    }
    return parseContract(DeviceCommandListResponse, await response.json(), "command list");
  }

  /** Acknowledging is idempotent on the API side; a retry after a timeout is safe. */
  async ack(
    credentials: DeviceCredentials,
    commandId: string,
    ack: AckDeviceCommandRequest,
  ): Promise<void> {
    const body = JSON.stringify(
      parseContract(AckDeviceCommandRequestSchema, ack, "acknowledgement"),
    );
    const path = `/v1/devices/${credentials.deviceId}/commands/${commandId}/ack`;
    const response = await this.send(credentials, "POST", path, body);
    if (!response.ok) {
      await this.fail(response);
    }
  }

  /**
   * What this device is allowed to touch (FR-DEV-05).
   *
   * Fetched rather than cached: a workspace removed in the browser must stop
   * being a root here on the next check, and the API is the only place that
   * knows. One call returns roots and grants together because each is useless
   * without the other (docs/planning/09 §6).
   */
  async workspacePolicy(credentials: DeviceCredentials): Promise<DeviceWorkspacePolicy> {
    const path = `/v1/devices/${credentials.deviceId}/workspaces`;
    const response = await this.send(credentials, "GET", path, null);
    if (!response.ok) {
      await this.fail(response);
    }
    return parseContract(DeviceWorkspacePolicy, await response.json(), "workspace policy");
  }
}
