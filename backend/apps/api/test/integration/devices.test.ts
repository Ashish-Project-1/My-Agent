// scan-secrets:allow-file — the password and connection string here are test fixtures.
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as signEd25519,
} from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  canonicalDeviceCommand,
  canonicalDeviceRequest,
  DEVICE_ID_HEADER,
  DEVICE_SIGNATURE_HEADER,
  DEVICE_TIMESTAMP_HEADER,
  type DeviceSummary,
  type PairingCodeResponse,
} from "@ua/contracts";
import { createPrismaClient } from "@ua/database";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://universal_agent:postgres@127.0.0.1:55432/universal_agent?schema=public";

const prisma = createPrismaClient(DATABASE_URL);

const RUNNER_VERSION = "0.1.0";

async function cleanup() {
  // Children before parents: the tenancy roots are ON DELETE RESTRICT, and a
  // command holds the device that queued it.
  await prisma.task_checkpoints.deleteMany();
  await prisma.task_events.deleteMany();
  await prisma.task_steps.deleteMany();
  await prisma.tasks.deleteMany();
  await prisma.agent_sessions.deleteMany();
  await prisma.device_commands.deleteMany();
  await prisma.device_pairing_codes.deleteMany();
  await prisma.workspace_grants.deleteMany();
  await prisma.workspaces.deleteMany();
  await prisma.devices.deleteMany();
  await prisma.outbox.deleteMany();
  await prisma.job_leases.deleteMany();
  await prisma.idempotency_keys.deleteMany();
  await prisma.login_attempts.deleteMany();
  await prisma.refresh_tokens.deleteMany();
  await prisma.sessions.deleteMany();
  await prisma.memberships.deleteMany();
  await prisma.invitations.deleteMany();
  await prisma.audit_events.deleteMany();
  await prisma.organizations.deleteMany();
  await prisma.users.deleteMany();
}

function extractCookie(
  res: { cookies?: Array<{ name: string; value?: string }>; body: string },
  name: string,
): string {
  const cookie = res.cookies?.find((c) => c.name === name);
  if (cookie?.value === undefined) {
    throw new Error(`expected a ${name} cookie on the response`);
  }
  return cookie.value;
}

type Registered = { session: string; csrf: string; organizationId: string; userId: string };

async function register(app: NestFastifyApplication, email: string): Promise<Registered> {
  const res = await app.inject({
    method: "POST",
    url: "/v1/auth/register",
    payload: { email, password: "Password123456" },
  });
  expect(res.statusCode).toBe(201);
  const body = JSON.parse(res.body);
  return {
    session: extractCookie(res, "ua_session"),
    csrf: extractCookie(res, "ua_csrf"),
    organizationId: body.activeOrganizationId,
    userId: body.user.id,
  };
}

function sessionCookies(user: Registered) {
  return { ua_session: user.session, ua_csrf: user.csrf };
}

async function post(
  app: NestFastifyApplication,
  user: Registered,
  url: string,
  payload: Record<string, unknown> = {},
) {
  return app.inject({
    method: "POST",
    url,
    cookies: sessionCookies(user),
    headers: { "x-csrf-token": user.csrf },
    payload,
  });
}

async function get(app: NestFastifyApplication, user: Registered, url: string) {
  return app.inject({ method: "GET", url, cookies: sessionCookies(user) });
}

// --- the device side: an independent implementation of the documented scheme ---

interface DeviceKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly fingerprint: string;
}

/**
 * A device built from the documented canonical form, not imported from
 * `@ua/local-runner`: the API suite must not depend on its client, and a shared
 * implementation could be wrong in the same direction twice.
 */
function newDeviceKeys(): DeviceKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return {
    publicKey: spki,
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    fingerprint: createHash("sha256").update(Buffer.from(spki, "base64")).digest("hex"),
  };
}

interface SignOptions {
  readonly deviceId?: string;
  readonly timestamp?: string;
  /** Sign the right bytes, send the wrong ones: the signature no longer verifies. */
  readonly tampered?: boolean;
  /** Sign a different path from the one requested. */
  readonly signedPath?: string;
}

function deviceHeaders(
  keys: DeviceKeys,
  method: string,
  path: string,
  body: string,
  options: SignOptions = {},
): Record<string, string> {
  const timestamp = options.timestamp ?? new Date().toISOString();
  const canonical = canonicalDeviceRequest({
    method,
    path: options.signedPath ?? path,
    timestamp,
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
  });
  const key = createPrivateKey({
    key: Buffer.from(keys.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  const signature = signEd25519(null, Buffer.from(canonical, "utf8"), key);
  return {
    "content-type": "application/json",
    ...(options.deviceId === undefined ? {} : { [DEVICE_ID_HEADER]: options.deviceId }),
    [DEVICE_TIMESTAMP_HEADER]: timestamp,
    [DEVICE_SIGNATURE_HEADER]: (options.tampered
      ? Buffer.concat([Buffer.from([0]), signature.subarray(1)])
      : signature
    ).toString("base64"),
  };
}

function registerBody(
  code: string,
  keys: DeviceKeys,
  name = "DESKTOP-01",
  fingerprint: string = keys.fingerprint,
): string {
  return JSON.stringify({
    pairingCode: code,
    name,
    os: "win32",
    osVersion: "10.0.26100",
    runnerVersion: RUNNER_VERSION,
    publicKey: keys.publicKey,
    keyAlgorithm: "ed25519",
    fingerprint,
    capabilities: { commands: ["diagnostics_ping"], playwright: false },
  });
}

/** Register exactly as the runner does: signed with the key it is presenting. */
async function registerDevice(
  app: NestFastifyApplication,
  keys: DeviceKeys,
  code: string,
  name?: string,
  fingerprint?: string,
) {
  const body = registerBody(code, keys, name, fingerprint);
  return app.inject({
    method: "POST",
    url: "/v1/devices",
    headers: deviceHeaders(keys, "POST", "/v1/devices", body),
    payload: body,
  });
}

async function deviceGet(
  app: NestFastifyApplication,
  keys: DeviceKeys,
  deviceId: string,
  url: string,
  options: SignOptions = {},
) {
  return app.inject({
    method: "GET",
    url,
    headers: deviceHeaders(keys, "GET", url, "", { deviceId, ...options }),
  });
}

async function devicePost(
  app: NestFastifyApplication,
  keys: DeviceKeys,
  deviceId: string,
  url: string,
  body: string,
) {
  return app.inject({
    method: "POST",
    url,
    headers: deviceHeaders(keys, "POST", url, body, { deviceId }),
    payload: body,
  });
}

/** Ask for a code, pair a device with it. The device is left `pending`. */
async function pairDevice(app: NestFastifyApplication, user: Registered, name = "DESKTOP-01") {
  const created = await post(app, user, "/v1/devices/pairing-codes");
  expect(created.statusCode).toBe(201);
  const code = JSON.parse(created.body) as PairingCodeResponse;

  const keys = newDeviceKeys();
  const res = await registerDevice(app, keys, code.code, name);
  expect(res.statusCode).toBe(201);
  return { code, keys, device: JSON.parse(res.body).device as DeviceSummary };
}

async function approve(app: NestFastifyApplication, user: Registered, deviceId: string) {
  const res = await post(app, user, `/v1/devices/${deviceId}/approve`);
  expect(res.statusCode).toBe(200);
  return res;
}

describe("devices integration", () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    process.env.AUTH_DIGEST_SECRET = "test_digest_secret_1234567890abcdef12";
    process.env.NODE_ENV = "test";
    process.env.DATABASE_URL = DATABASE_URL;
    app = await createApp();
    await app.init();
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await cleanup();
  });

  it("pairs a device: the member asks, the device proves its key, a human approves", async () => {
    const owner = await register(app, "owner@example.com");

    const created = await post(app, owner, "/v1/devices/pairing-codes");
    expect(created.statusCode).toBe(201);
    const code = JSON.parse(created.body) as PairingCodeResponse;
    expect(code.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);

    // Only the hash is stored, so a dump of this table hands over no usable code.
    const stored = await prisma.device_pairing_codes.findUnique({
      where: { id: code.id },
      select: { code_hash: true, redeemed_at: true },
    });
    expect(stored?.code_hash).not.toContain(code.code);
    expect(stored?.redeemed_at).toBeNull();

    const keys = newDeviceKeys();
    const registered = await registerDevice(app, keys, code.code);
    expect(registered.statusCode).toBe(201);
    const device = JSON.parse(registered.body).device as DeviceSummary;

    expect(device.status).toBe("pending");
    expect(device.ownerUserId).toBe(owner.userId);
    expect(device.fingerprint).toBe(keys.fingerprint);
    expect(device.lastSeenAt).toBeNull();
    // The API holds a public key and never echoes a private one back.
    expect(registered.body).not.toContain(keys.privateKey);

    // The code is spent by the registration, not by the approval.
    const redeemed = await prisma.device_pairing_codes.findUnique({
      where: { id: code.id },
      select: { redeemed_at: true },
    });
    expect(redeemed?.redeemed_at).not.toBeNull();
    expect((await registerDevice(app, newDeviceKeys(), code.code)).statusCode).toBe(400);

    // A pending device is not a device: it cannot collect work yet.
    expect(
      (await deviceGet(app, keys, device.id, `/v1/devices/${device.id}/commands`)).statusCode,
    ).toBe(401);

    const listed = JSON.parse((await get(app, owner, "/v1/devices")).body) as {
      devices: DeviceSummary[];
    };
    expect(listed.devices.map((row) => row.id)).toEqual([device.id]);

    const approved = await post(app, owner, `/v1/devices/${device.id}/approve`, {
      name: "WORKSTATION",
    });
    expect(approved.statusCode).toBe(200);
    expect(JSON.parse(approved.body).status).toBe("active");
    expect(JSON.parse(approved.body).name).toBe("WORKSTATION");

    // Approval is a one-way door.
    expect((await post(app, owner, `/v1/devices/${device.id}/approve`)).statusCode).toBe(409);

    // Approved, so the same signed request that was refused a moment ago works.
    const collecting = await deviceGet(
      app,
      keys,
      device.id,
      `/v1/devices/${device.id}/commands?cursor=0&waitSeconds=0`,
    );
    expect(collecting.statusCode).toBe(200);
    expect(JSON.parse(collecting.body)).toEqual({ commands: [], cursor: 0 });
    expect(
      JSON.parse((await get(app, owner, `/v1/devices/${device.id}`)).body).lastSeenAt,
    ).not.toBeNull();
  });

  it("refuses a registration that cannot prove it holds the key it presents", async () => {
    const owner = await register(app, "signature@example.com");
    const created = await post(app, owner, "/v1/devices/pairing-codes");
    const code = (JSON.parse(created.body) as PairingCodeResponse).code;
    const keys = newDeviceKeys();

    // Unsigned.
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/devices",
          headers: { "content-type": "application/json" },
          payload: registerBody(code, keys),
        })
      ).statusCode,
    ).toBe(401);

    // Signed by a different key from the one in the body.
    const body = registerBody(code, keys);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/devices",
          headers: deviceHeaders(newDeviceKeys(), "POST", "/v1/devices", body),
          payload: body,
        })
      ).statusCode,
    ).toBe(401);

    // A fingerprint that is not the key's: the API derives it rather than trusting it.
    const lying = registerBody(code, keys, "DESKTOP-01", "b".repeat(64));
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/v1/devices",
          headers: deviceHeaders(keys, "POST", "/v1/devices", lying),
          payload: lying,
        })
      ).statusCode,
    ).toBe(400);

    // A code nobody issued.
    expect((await registerDevice(app, keys, "AAAA-BBBB")).statusCode).toBe(400);

    // None of those redeemed anything, so the real registration still works.
    expect((await registerDevice(app, keys, code)).statusCode).toBe(201);
  });

  it("lets a colleague see a device but not command it, and hides another organization's", async () => {
    const owner = await register(app, "owner@example.com");
    const { device } = await pairDevice(app, owner);

    // A plain member of the same organization: visibility is a member's, control
    // is the owner's (or an admin's).
    const mate = await register(app, "mate@example.com");
    await prisma.memberships.create({
      data: {
        organization_id: owner.organizationId,
        user_id: mate.userId,
        role: "member",
      },
    });
    await prisma.sessions.updateMany({
      where: { user_id: mate.userId },
      data: { organization_id: owner.organizationId },
    });

    expect((await get(app, mate, `/v1/devices/${device.id}`)).statusCode).toBe(200);
    expect(JSON.parse((await get(app, mate, "/v1/devices")).body).devices).toHaveLength(1);
    expect((await post(app, mate, `/v1/devices/${device.id}/approve`)).statusCode).toBe(403);
    expect(
      (await post(app, mate, `/v1/devices/${device.id}/revoke`, { reason: "not mine" })).statusCode,
    ).toBe(403);

    // Another organization cannot see it at all — not a 403, a 404, because
    // "exists elsewhere" is not something a stranger may learn.
    const stranger = await register(app, "stranger@example.com");
    expect((await get(app, stranger, `/v1/devices/${device.id}`)).statusCode).toBe(404);
    expect((await post(app, stranger, `/v1/devices/${device.id}/approve`)).statusCode).toBe(404);
    expect(JSON.parse((await get(app, stranger, "/v1/devices")).body).devices).toHaveLength(0);
  });

  it("delivers queued work, requeues it until acknowledged, and acks idempotently", async () => {
    const owner = await register(app, "commands@example.com");
    const { keys, device } = await pairDevice(app, owner);
    await approve(app, owner, device.id);

    const queued = await post(app, owner, `/v1/devices/${device.id}/commands`, {
      kind: "diagnostics_ping",
    });
    expect(queued.statusCode).toBe(201);
    const command = JSON.parse(queued.body).command as {
      id: string;
      seq: number;
      kind: string;
      expiresAt: string;
    };
    expect(command.kind).toBe("diagnostics_ping");

    const path = `/v1/devices/${device.id}/commands?cursor=0&waitSeconds=0`;
    const delivered = JSON.parse((await deviceGet(app, keys, device.id, path)).body) as {
      commands: Array<{ id: string; seq: number; commandDigest: string }>;
      cursor: number;
    };
    expect(delivered.cursor).toBe(1);
    expect(delivered.commands.map((c) => c.id)).toEqual([command.id]);
    // The digest is over what the device received, so the runner can recompute
    // it and see that a relayed command was not altered.
    expect(delivered.commands[0]?.commandDigest).toBe(
      createHash("sha256")
        .update(
          canonicalDeviceCommand({
            deviceId: device.id,
            kind: "diagnostics_ping",
            payload: null,
            expiresAt: command.expiresAt,
          }),
          "utf8",
        )
        .digest("hex"),
    );

    // Handed out but not acknowledged: not handed over again inside the window...
    const immediate = await deviceGet(app, keys, device.id, path);
    expect(JSON.parse(immediate.body)).toEqual({ commands: [], cursor: 0 });

    // ...but the requeue window brings it back rather than losing it (FR-DEV-04).
    await prisma.device_commands.updateMany({
      where: { id: command.id },
      data: { sent_at: new Date(Date.now() - 120_000) },
    });
    const requeued = JSON.parse(
      (
        await deviceGet(
          app,
          keys,
          device.id,
          `/v1/devices/${device.id}/commands?cursor=0&waitSeconds=0`,
        )
      ).body,
    ) as { commands: Array<{ id: string }> };
    expect(requeued.commands.map((row) => row.id)).toEqual([command.id]);

    // Acking twice is not an error: the device may not have seen the first 204.
    const ackPath = `/v1/devices/${device.id}/commands/${command.id}/ack`;
    const ack = JSON.stringify({ outcome: "acked" });
    expect((await devicePost(app, keys, device.id, ackPath, ack)).statusCode).toBe(204);
    expect((await devicePost(app, keys, device.id, ackPath, ack)).statusCode).toBe(204);

    // Acknowledged, so the next poll has nothing to hand over.
    const after = await deviceGet(
      app,
      keys,
      device.id,
      `/v1/devices/${device.id}/commands?cursor=1&waitSeconds=0`,
    );
    expect(JSON.parse(after.body)).toEqual({ commands: [], cursor: 1 });
  });

  it("refuses signatures that are absent, wrong, stale, or for another request", async () => {
    const owner = await register(app, "signature@example.com");
    const { keys, device } = await pairDevice(app, owner);
    await approve(app, owner, device.id);
    const path = `/v1/devices/${device.id}/commands`;

    // No signature at all.
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(401);

    // A signature of the right shape covering the wrong bytes.
    expect(
      (
        await app.inject({
          method: "GET",
          url: path,
          headers: deviceHeaders(keys, "GET", path, "", { deviceId: device.id, tampered: true }),
        })
      ).statusCode,
    ).toBe(401);

    // A valid signature, replayed an hour later.
    expect(
      (
        await app.inject({
          method: "GET",
          url: path,
          headers: deviceHeaders(keys, "GET", path, "", {
            deviceId: device.id,
            timestamp: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          }),
        })
      ).statusCode,
    ).toBe(401);

    // A signature for one query string cannot be spent on another.
    const signed = `${path}?cursor=0&waitSeconds=0`;
    expect(
      (
        await app.inject({
          method: "GET",
          url: `${path}?cursor=9&waitSeconds=0`,
          headers: deviceHeaders(keys, "GET", `${path}?cursor=9&waitSeconds=0`, "", {
            deviceId: device.id,
            signedPath: signed,
          }),
        })
      ).statusCode,
    ).toBe(401);

    // The id in the header and the id in the path are part of the same signed
    // request, so they can never name different devices.
    const strangerId = "01900000-0000-7000-8000-000000000000";
    const strangerPath = `/v1/devices/${strangerId}/commands`;
    expect(
      (
        await app.inject({
          method: "GET",
          url: strangerPath,
          headers: deviceHeaders(keys, "GET", strangerPath, "", { deviceId: device.id }),
        })
      ).statusCode,
    ).toBe(401);

    // An unknown device, and a malformed id — one answer, never a 500.
    expect(
      (
        await app.inject({
          method: "GET",
          url: strangerPath,
          headers: deviceHeaders(keys, "GET", strangerPath, "", { deviceId: strangerId }),
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: "GET",
          url: "/v1/devices/not-a-uuid/commands",
          headers: {
            [DEVICE_ID_HEADER]: "not-a-uuid",
            [DEVICE_TIMESTAMP_HEADER]: new Date().toISOString(),
            [DEVICE_SIGNATURE_HEADER]: "AAAA",
          },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("stops accepting a device the moment it is revoked, and empties its queue", async () => {
    const owner = await register(app, "revoke@example.com");
    const { keys, device } = await pairDevice(app, owner);
    await approve(app, owner, device.id);
    const queued = await post(app, owner, `/v1/devices/${device.id}/commands`, {
      kind: "diagnostics_ping",
    });
    expect(queued.statusCode).toBe(201);

    const revoked = await post(app, owner, `/v1/devices/${device.id}/revoke`, {
      reason: "laptop was stolen",
    });
    expect(revoked.statusCode).toBe(200);
    expect((JSON.parse(revoked.body) as DeviceSummary).status).toBe("revoked");

    // The very next signed request is refused: a device key is not a token that
    // outlives the decision to remove it (FR-DEV-08).
    expect(
      (
        await deviceGet(
          app,
          keys,
          device.id,
          `/v1/devices/${device.id}/commands?cursor=0&waitSeconds=0`,
        )
      ).statusCode,
    ).toBe(401);

    // Anything already queued expired with the revocation, so nothing is waiting.
    const rows = await prisma.device_commands.findMany({
      where: { device_id: device.id },
      select: { state: true },
    });
    expect(rows.map((row) => row.state)).toEqual(["expired"]);

    // Revoking twice, or approving a revoked device, is a state conflict.
    expect(
      (await post(app, owner, `/v1/devices/${device.id}/revoke`, { reason: "again" })).statusCode,
    ).toBe(409);
    expect((await post(app, owner, `/v1/devices/${device.id}/approve`)).statusCode).toBe(409);
  });

  it("denies a device at pairing, which is recorded as a revocation", async () => {
    const owner = await register(app, "deny@example.com");
    const { keys, device } = await pairDevice(app, owner);

    const denied = await post(app, owner, `/v1/devices/${device.id}/deny`);
    expect(denied.statusCode).toBe(200);
    expect((JSON.parse(denied.body) as DeviceSummary).status).toBe("revoked");
    expect(
      (await deviceGet(app, keys, device.id, `/v1/devices/${device.id}/commands`)).statusCode,
    ).toBe(401);

    const trail = await prisma.audit_events.findFirst({
      where: { organization_id: owner.organizationId, action: "device.revoke" },
      select: { reason: true },
    });
    expect(trail?.reason).toBe("denied at pairing");
  });
});
