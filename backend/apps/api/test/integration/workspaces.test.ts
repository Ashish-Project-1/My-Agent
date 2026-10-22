// scan-secrets:allow-file — the password and connection string here are test fixtures.
import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as signEd25519,
} from "node:crypto";
import type { NestFastifyApplication } from "@nestjs/platform-fastify";
import {
  canonicalDeviceRequest,
  DEVICE_ID_HEADER,
  DEVICE_SIGNATURE_HEADER,
  DEVICE_TIMESTAMP_HEADER,
  type DeviceSummary,
  type PairingCodeResponse,
  type WorkspaceGrantSummary,
  type WorkspaceSummary,
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
  // Children before parents, and grants before the workspace they hang from.
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

async function send(
  app: NestFastifyApplication,
  user: Registered,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  url: string,
  payload?: Record<string, unknown>,
) {
  return app.inject({
    method,
    url,
    cookies: sessionCookies(user),
    headers: { "x-csrf-token": user.csrf },
    ...(payload !== undefined ? { payload } : method === "POST" ? { payload: {} } : {}),
  });
}

// --- the device side: an independent implementation of the documented scheme ---

interface DeviceKeys {
  readonly publicKey: string;
  readonly privateKey: string;
  readonly fingerprint: string;
}

function newDeviceKeys(): DeviceKeys {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const spki = publicKey.export({ format: "der", type: "spki" }).toString("base64");
  return {
    publicKey: spki,
    privateKey: privateKey.export({ format: "der", type: "pkcs8" }).toString("base64"),
    fingerprint: createHash("sha256").update(Buffer.from(spki, "base64")).digest("hex"),
  };
}

function deviceHeaders(
  keys: DeviceKeys,
  method: string,
  path: string,
  body: string,
  deviceId?: string,
): Record<string, string> {
  const timestamp = new Date().toISOString();
  const canonical = canonicalDeviceRequest({
    method,
    path,
    timestamp,
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
  });
  const key = createPrivateKey({
    key: Buffer.from(keys.privateKey, "base64"),
    format: "der",
    type: "pkcs8",
  });
  return {
    "content-type": "application/json",
    ...(deviceId === undefined ? {} : { [DEVICE_ID_HEADER]: deviceId }),
    [DEVICE_TIMESTAMP_HEADER]: timestamp,
    [DEVICE_SIGNATURE_HEADER]: signEd25519(null, Buffer.from(canonical, "utf8"), key).toString(
      "base64",
    ),
  };
}

/**
 * A paired, approved device owned by `user`, reporting `os` as its platform —
 * which is what decides whether its paths are read as Windows or POSIX.
 */
async function pairedDevice(
  app: NestFastifyApplication,
  user: Registered,
  os = "win32",
): Promise<{ keys: DeviceKeys; device: DeviceSummary }> {
  const created = await send(app, user, "POST", "/v1/devices/pairing-codes");
  expect(created.statusCode).toBe(201);
  const code = JSON.parse(created.body) as PairingCodeResponse;

  const keys = newDeviceKeys();
  const body = JSON.stringify({
    pairingCode: code.code,
    name: "DESKTOP-01",
    os,
    osVersion: "10.0.26100",
    runnerVersion: RUNNER_VERSION,
    publicKey: keys.publicKey,
    keyAlgorithm: "ed25519",
    fingerprint: keys.fingerprint,
    capabilities: { commands: ["diagnostics_ping"], playwright: false },
  });
  const registered = await app.inject({
    method: "POST",
    url: "/v1/devices",
    headers: deviceHeaders(keys, "POST", "/v1/devices", body),
    payload: body,
  });
  expect(registered.statusCode).toBe(201);
  const device = JSON.parse(registered.body).device as DeviceSummary;

  const approved = await send(app, user, "POST", `/v1/devices/${device.id}/approve`);
  expect(approved.statusCode).toBe(200);
  return { keys, device: JSON.parse(approved.body) as DeviceSummary };
}

async function registerWorkspace(
  app: NestFastifyApplication,
  user: Registered,
  input: { deviceId: string; path: string; mode?: "read_only" | "read_write"; label?: string },
): Promise<WorkspaceSummary> {
  const res = await send(app, user, "POST", "/v1/workspaces", {
    mode: "read_write",
    ...input,
  });
  expect(res.statusCode).toBe(201);
  return JSON.parse(res.body) as WorkspaceSummary;
}

async function devicePolicy(
  app: NestFastifyApplication,
  keys: DeviceKeys,
  deviceId: string,
): Promise<{ workspaces: WorkspaceSummary[]; grants: WorkspaceGrantSummary[] }> {
  const path = `/v1/devices/${deviceId}/workspaces`;
  const res = await app.inject({
    method: "GET",
    url: path,
    headers: deviceHeaders(keys, "GET", path, "", deviceId),
  });
  expect(res.statusCode).toBe(200);
  return JSON.parse(res.body);
}

/** Puts `user` in `owner`'s organization with the given role. */
async function join(user: Registered, owner: Registered, role: "admin" | "member"): Promise<void> {
  await prisma.memberships.create({
    data: { organization_id: owner.organizationId, user_id: user.userId, role },
  });
  await prisma.sessions.updateMany({
    where: { user_id: user.userId },
    data: { organization_id: owner.organizationId },
  });
}

describe("workspaces integration", () => {
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

  it("registers a directory as its canonical path and keeps what was typed", async () => {
    const owner = await register(app, "workspace@example.com");
    const { device } = await pairedDevice(app, owner);

    const workspace = await registerWorkspace(app, owner, {
      deviceId: device.id,
      // Separators, drive case, a `.` and a trailing separator: one directory.
      path: "f:/My Project/./My Agent/",
    });

    expect(workspace.path).toBe("F:\\My Project\\My Agent");
    expect(workspace.rawPath).toBe("f:/My Project/./My Agent/");
    expect(workspace.mode).toBe("read_write");
    // The label defaults to the directory's own name.
    expect(workspace.label).toBe("My Agent");
    expect(workspace.deviceId).toBe(device.id);
    expect(workspace.lastUsedAt).toBeNull();

    const trail = await prisma.audit_events.findFirst({
      where: { organization_id: owner.organizationId, action: "workspace.create" },
      select: { resource_id: true, metadata: true },
    });
    expect(trail?.resource_id).toBe(workspace.id);
    expect(trail?.metadata).toMatchObject({ path: "F:\\My Project\\My Agent" });

    const listed = JSON.parse((await send(app, owner, "GET", "/v1/workspaces")).body) as {
      workspaces: WorkspaceSummary[];
    };
    expect(listed.workspaces.map((row) => row.id)).toEqual([workspace.id]);
  });

  it("refuses every escape vector with its own reason, and writes nothing", async () => {
    const owner = await register(app, "hostile@example.com");
    const { device } = await pairedDevice(app, owner);

    const hostile: ReadonlyArray<readonly [string, string]> = [
      ["\\\\server\\share\\code", "network share"],
      ["//server/share/code", "network share"],
      ["\\\\?\\C:\\code", "verbatim"],
      ["\\\\.\\PHYSICALDRIVE0", "verbatim"],
      ["C:code", "absolute path"],
      ["\\code", "absolute path"],
      ["C:\\code\\..\\..\\Windows", "above its own root"],
      ["C:\\code\\nul\\x", "Windows device"],
      ["C:\\code\\notes.txt:hidden", "alternate data stream"],
      ["C:\\code\\name \\child", "dot or a space"],
      ["C:\\code\\name ", "dot or a space"],
      ["C:\\code\u0000x", "control character"],
    ];

    for (const [path, fragment] of hostile) {
      const res = await send(app, owner, "POST", "/v1/workspaces", {
        deviceId: device.id,
        path,
        mode: "read_write",
      });
      expect(res.statusCode, path).toBe(400);
      expect(JSON.parse(res.body).detail, path).toContain(fragment);
    }

    // A refused registration is not a registration: no row, and no audit row
    // claiming the platform was asked to open a system directory.
    expect(await prisma.workspaces.count()).toBe(0);
    expect(await prisma.audit_events.count({ where: { action: "workspace.create" } })).toBe(0);
  });

  it("reads the path grammar off the device, not off the API", async () => {
    const owner = await register(app, "platform@example.com");
    const windows = await pairedDevice(app, owner, "win32");
    const linux = await pairedDevice(app, owner, "linux");

    // The same string is one directory on one machine and refuses on the other.
    const unix = await registerWorkspace(app, owner, {
      deviceId: linux.device.id,
      path: "/srv/./code/../code",
    });
    expect(unix.path).toBe("/srv/code");

    const refused = await send(app, owner, "POST", "/v1/workspaces", {
      deviceId: windows.device.id,
      path: "/srv/code",
      mode: "read_write",
    });
    expect(refused.statusCode).toBe(400);
    expect(JSON.parse(refused.body).detail).toContain("absolute path");
  });

  it("refuses the same directory twice on one device, and allows it on another", async () => {
    const owner = await register(app, "duplicate@example.com");
    const first = await pairedDevice(app, owner);
    const second = await pairedDevice(app, owner);

    await registerWorkspace(app, owner, {
      deviceId: first.device.id,
      path: "F:\\Project",
    });

    const again = await send(app, owner, "POST", "/v1/workspaces", {
      deviceId: first.device.id,
      // The same directory, spelled inside out.
      path: "F:\\Project\\src\\..",
      mode: "read_write",
    });
    expect(again.statusCode).toBe(409);
    expect(JSON.parse(again.body).code).toBe("conflict");

    // The constraint is per device: a laptop and a desktop have their own
    // `F:\Project`, and both are legitimate.
    const elsewhere = await registerWorkspace(app, owner, {
      deviceId: second.device.id,
      path: "F:\\Project",
    });
    expect(elsewhere.path).toBe("F:\\Project");
  });

  it("lets a colleague see the roots but not change them, and hides other tenants", async () => {
    const owner = await register(app, "roots@example.com");
    const { device } = await pairedDevice(app, owner);
    const workspace = await registerWorkspace(app, owner, {
      deviceId: device.id,
      path: "F:\\Project",
    });

    const mate = await register(app, "mate@example.com");
    await join(mate, owner, "member");
    expect(
      (
        await send(app, mate, "POST", "/v1/workspaces", {
          deviceId: device.id,
          path: "F:\\Other",
          mode: "read_write",
        })
      ).statusCode,
    ).toBe(403);
    // Seeing the organization's roots is a member's business: it is what an
    // agent's task list is drawn against.
    expect(
      JSON.parse((await send(app, mate, "GET", "/v1/workspaces")).body).workspaces,
    ).toHaveLength(1);

    const admin = await register(app, "admin@example.com");
    await join(admin, owner, "admin");
    const added = await send(app, admin, "POST", "/v1/workspaces", {
      deviceId: device.id,
      path: "F:\\Other",
      mode: "read_only",
    });
    expect(added.statusCode).toBe(201);

    // Another organization cannot see the row at all.
    const stranger = await register(app, "stranger@example.com");
    expect((await send(app, stranger, "GET", `/v1/workspaces/${workspace.id}`)).statusCode).toBe(
      404,
    );
    expect(
      (
        await send(app, stranger, "POST", "/v1/workspaces", {
          deviceId: device.id,
          path: "F:\\Project",
          mode: "read_write",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      JSON.parse((await send(app, stranger, "GET", "/v1/workspaces")).body).workspaces,
    ).toEqual([]);
  });

  it("changes what a workspace allows, and hands the device exactly that", async () => {
    const owner = await register(app, "grants@example.com");
    const { keys, device } = await pairedDevice(app, owner);
    const workspace = await registerWorkspace(app, owner, {
      deviceId: device.id,
      path: "F:\\Project",
      label: "Project",
    });

    // A standing allow that reaches outside every root, and a deny inside one.
    const allow = await send(app, owner, "POST", `/v1/workspaces/${workspace.id}/grants`, {
      pathPattern: "C:\\Users\\a\\Documents\\inbox",
      effect: "allow",
    });
    expect(allow.statusCode).toBe(201);
    const allowGrant = JSON.parse(allow.body) as WorkspaceGrantSummary;
    expect(allowGrant.pathPattern).toBe("C:\\Users\\a\\Documents\\inbox");
    expect(allowGrant.effect).toBe("allow");
    expect(allowGrant.expiresAt).toBeNull();
    expect(allowGrant.policyVersion).toBe(1);

    const deny = await send(app, owner, "POST", `/v1/workspaces/${workspace.id}/grants`, {
      pathPattern: "F:\\Project\\secrets",
      effect: "deny",
    });
    expect(deny.statusCode).toBe(201);

    // A grant is a path too, and is refused like one.
    const hostile = await send(app, owner, "POST", `/v1/workspaces/${workspace.id}/grants`, {
      pathPattern: "\\\\server\\share",
      effect: "allow",
    });
    expect(hostile.statusCode).toBe(400);

    const listed = JSON.parse(
      (await send(app, owner, "GET", `/v1/workspaces/${workspace.id}/grants`)).body,
    ) as { grants: WorkspaceGrantSummary[] };
    expect(listed.grants).toHaveLength(2);

    // The device is handed the roots, the grants, and nothing else.
    const policy = await devicePolicy(app, keys, device.id);
    expect(policy.workspaces.map((row) => row.id)).toEqual([workspace.id]);
    expect(policy.grants.map((grant) => grant.id).sort()).toEqual(
      [allowGrant.id, JSON.parse(deny.body).id].sort(),
    );

    // An expired grant is still visible to a person — it lapsed, that is worth
    // seeing — but it is never handed to the side that enforces it.
    await prisma.workspace_grants.update({
      where: { id: allowGrant.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });
    const after = await devicePolicy(app, keys, device.id);
    expect(after.grants.map((grant) => grant.id)).toEqual([JSON.parse(deny.body).id]);
    expect(
      (
        JSON.parse(
          (await send(app, owner, "GET", `/v1/workspaces/${workspace.id}/grants`)).body,
        ) as {
          grants: WorkspaceGrantSummary[];
        }
      ).grants,
    ).toHaveLength(2);

    // Revoking a grant takes it off both lists.
    const revoked = await send(app, owner, "DELETE", `/v1/grants/${allowGrant.id}`);
    expect(revoked.statusCode).toBe(204);
    expect((await devicePolicy(app, keys, device.id)).grants).toHaveLength(1);
    expect((await send(app, owner, "DELETE", `/v1/grants/${allowGrant.id}`)).statusCode).toBe(404);

    const trail = await prisma.audit_events.findFirst({
      where: { organization_id: owner.organizationId, action: "workspace.grant.revoke" },
      select: { resource_id: true },
    });
    expect(trail?.resource_id).toBe(allowGrant.id);
  });

  it("answers the device only when its own key signed the request", async () => {
    const owner = await register(app, "policy@example.com");
    const { keys, device } = await pairedDevice(app, owner);
    const other = await pairedDevice(app, owner);

    const path = `/v1/devices/${other.device.id}/workspaces`;
    // No signature.
    expect((await app.inject({ method: "GET", url: path })).statusCode).toBe(401);
    // A valid signature by a *different* device: the id is part of the signed
    // request, so naming someone else's device cannot be a way to read its roots.
    expect(
      (
        await app.inject({
          method: "GET",
          url: path,
          headers: deviceHeaders(keys, "GET", path, "", device.id),
        })
      ).statusCode,
    ).toBe(401);
    expect(await devicePolicy(app, other.keys, other.device.id)).toEqual({
      workspaces: [],
      grants: [],
    });
  });

  it("updates a workspace's authority, and removing it removes its grants", async () => {
    const owner = await register(app, "update@example.com");
    const { keys, device } = await pairedDevice(app, owner);
    const workspace = await registerWorkspace(app, owner, {
      deviceId: device.id,
      path: "F:\\Project",
    });
    await send(app, owner, "POST", `/v1/workspaces/${workspace.id}/grants`, {
      pathPattern: "C:\\Users\\a\\inbox",
      effect: "allow",
    });

    const tightened = await send(app, owner, "PATCH", `/v1/workspaces/${workspace.id}`, {
      mode: "read_only",
      label: "Read only",
    });
    expect(tightened.statusCode).toBe(200);
    const updated = JSON.parse(tightened.body) as WorkspaceSummary;
    expect(updated.mode).toBe("read_only");
    expect(updated.label).toBe("Read only");
    // The path is not editable: changing what a workspace is, is a different
    // registration, and the audit trail keeps the two apart.
    expect(updated.path).toBe("F:\\Project");

    // A change with nothing in it is not a change.
    expect((await send(app, owner, "PATCH", `/v1/workspaces/${workspace.id}`, {})).statusCode).toBe(
      400,
    );

    const removed = await send(app, owner, "DELETE", `/v1/workspaces/${workspace.id}`);
    expect(removed.statusCode).toBe(204);
    expect(await devicePolicy(app, keys, device.id)).toEqual({ workspaces: [], grants: [] });
    expect(await prisma.workspaces.count()).toBe(0);
    expect(await prisma.workspace_grants.count()).toBe(0);
    expect((await send(app, owner, "DELETE", `/v1/workspaces/${workspace.id}`)).statusCode).toBe(
      404,
    );
  });
});
