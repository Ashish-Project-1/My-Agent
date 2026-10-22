import { hostname, platform, release } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AckDeviceCommandRequest,
  DeviceCommandListResponse,
  DeviceCommandSummary,
} from "@ua/contracts";
import { PAIRING_CODE_PATTERN } from "@ua/contracts";
import {
  deniedPaths,
  flavourForOs,
  InMemoryJobObjectController,
  runSandboxSelfTest,
} from "@ua/sandbox-manager";
import { capabilityReport, diagnosticsReport } from "./capabilities.js";
import { ApiError, DeviceClient, type DeviceCredentials } from "./client.js";
import { loadConfig, RUNNER_VERSION, type RunnerConfig } from "./config.js";
import { deviceFilePath, loadDevice, type StoredDevice, saveDevice } from "./device-store.js";
import { generateDeviceKeys } from "./keys.js";
import {
  enforcementRoots,
  grantRules,
  hostEnvironment,
  inspectWorkspaceRoots,
  type WorkspaceRootState,
} from "./workspace-roots.js";

/**
 * The runner's command line (docs/planning/09, 17 Phase 4).
 *
 * `pair` proves the machine to the API once; `run` then holds the outbound
 * command channel and executes what it is handed. Everything the API can ask
 * this machine to do passes through one switch, so what a paired device exposes
 * is a short function rather than whatever the runner happens to import.
 */

/** A pairing code lives ten minutes; waiting much longer than that is pointless. */
const APPROVAL_TIMEOUT_MS = 5 * 60 * 1000;

/** How often a pending device asks whether a human has decided yet. */
const APPROVAL_POLL_MS = 2000;

/** Backoff after a transport failure, so a stopped API is not hammered. */
const RETRY_DELAY_MS = 5000;

const USAGE = `ua-runner ${RUNNER_VERSION} — the local device runner

Usage:
  ua-runner pair --code <CODE> [--name <NAME>] [--api <ORIGIN>] [--data-dir <DIR>]
  ua-runner run [--api <ORIGIN>] [--data-dir <DIR>]
  ua-runner workspaces [--api <ORIGIN>] [--data-dir <DIR>]
  ua-runner sandbox-test [--data-dir <DIR>]
  ua-runner status [--data-dir <DIR>]

Options:
  --code <CODE>     The pairing code from the browser (Devices → Pair a device).
  --name <NAME>     The name this machine is listed under (default: its hostname).
  --api <ORIGIN>    API origin (default: $UA_API_ORIGIN, else http://127.0.0.1:3000).
  --data-dir <DIR>  Where the device keypair lives (default: $UA_DATA_DIR, else per-user).`;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * `4k7q2m3x` and `4K7Q-2M3X` are the same code, and the API accepts only the
 * second form: the dash is for the human, not for the hash.
 */
function formatPairingCode(input: string): string {
  const cleaned = input.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (cleaned.length !== 8) {
    return input;
  }
  const formatted = `${cleaned.slice(0, 4)}-${cleaned.slice(4)}`;
  if (!PAIRING_CODE_PATTERN.test(formatted)) {
    // I, L, O and U never occur in a real code, so this is a mistyped one.
    throw new Error(`"${input}" is not a pairing code (it cannot contain I, L, O or U)`);
  }
  return formatted;
}

interface ParsedArgs {
  readonly command: string | undefined;
  readonly flags: Map<string, string>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string>();
  let command: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === undefined) {
      continue;
    }
    if (!arg.startsWith("--")) {
      command ??= arg;
      continue;
    }
    const [key, inline] = arg.slice(2).split("=", 2);
    if (key === undefined) {
      continue;
    }
    const next = argv[index + 1];
    if (inline !== undefined) {
      flags.set(key, inline);
    } else if (next === undefined || next.startsWith("--")) {
      flags.set(key, "");
    } else {
      flags.set(key, next);
      index += 1;
    }
  }
  return { command, flags };
}

function configFrom(flags: Map<string, string>): RunnerConfig {
  const api = flags.get("api");
  const dataDir = flags.get("data-dir");
  return loadConfig(process.env, {
    ...(api === undefined || api === "" ? {} : { apiOrigin: api }),
    ...(dataDir === undefined || dataDir === "" ? {} : { dataDir }),
  });
}

function apiFlagFor(config: RunnerConfig): string {
  return config.apiOrigin === "http://127.0.0.1:3000" ? "" : ` --api ${config.apiOrigin}`;
}

/**
 * Register this machine, then wait for a human.
 *
 * Approval is not something the API can push to a device it has not accepted
 * yet, so the device asks. Until a member approves it every signed request is
 * refused with 401 — a device that is not `active` is not a device
 * (docs/planning/07 §3.6) — and that refusal is the state being waited on.
 */
async function pair(config: RunnerConfig, flags: Map<string, string>): Promise<number> {
  const code = flags.get("code");
  if (code === undefined || code === "") {
    console.error("pair needs --code <CODE> (ask for one under Devices in the browser).");
    return 2;
  }

  const existing = loadDevice(config.dataDir);
  if (existing !== null) {
    console.error(
      `This machine is already paired as ${existing.name} (${existing.deviceId}).\n` +
        `Revoke it in the browser, then delete ${deviceFilePath(config.dataDir)}.`,
    );
    return 2;
  }

  const keys = generateDeviceKeys();
  const client = new DeviceClient(config.apiOrigin);
  const device = await client.register({
    pairingCode: formatPairingCode(code),
    name: flags.get("name") || hostname(),
    os: platform(),
    osVersion: release(),
    runnerVersion: RUNNER_VERSION,
    keys,
    capabilities: capabilityReport(),
  });

  console.log(`Registering ${device.name} with ${config.apiOrigin}`);
  console.log(`Key fingerprint ${keys.fingerprint}`);
  console.log("Waiting for approval in the browser (Devices → Approve)…");

  const credentials: DeviceCredentials = { deviceId: device.id, privateKey: keys.privateKey };
  if (!(await waitForApproval(client, credentials))) {
    return 1;
  }

  const stored: StoredDevice = {
    deviceId: device.id,
    name: device.name,
    apiOrigin: config.apiOrigin,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
    fingerprint: keys.fingerprint,
    cursor: 0,
  };
  saveDevice(config.dataDir, stored);

  console.log(`Paired as ${device.name} (${device.id}).`);
  console.log(`Identity saved to ${deviceFilePath(config.dataDir)} — keep it private.`);
  console.log(`Start the command channel with: ua-runner run${apiFlagFor(config)}`);
  return 0;
}

async function waitForApproval(
  client: DeviceClient,
  credentials: DeviceCredentials,
): Promise<boolean> {
  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await delay(APPROVAL_POLL_MS);
    try {
      await client.poll(credentials, 0, 0);
      return true;
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        continue;
      }
      if (error instanceof ApiError && (error.status === 403 || error.status === 404)) {
        console.error(`\nThis device was denied or removed (${error.code}).`);
        return false;
      }
      if (error instanceof ApiError) {
        console.error(`\nThe API refused this device (${error.status} ${error.code}).`);
        return false;
      }
      // A transport failure says nothing about approval, so keep asking.
      console.error(`\nStill waiting: ${describe(error)}`);
    }
  }
  console.error("Timed out waiting for approval. Ask for a new code and try again.");
  return false;
}

/**
 * Hold the command channel open.
 *
 * The cursor kept here is the last sequence *acknowledged*, not the one the API
 * returned: a command received but not finished stays behind it and is handed
 * over again after the requeue window (FR-DEV-04). A device the API refuses
 * outright has been revoked, and stopping beats hammering a wall.
 */
async function run(config: RunnerConfig): Promise<number> {
  const stored = loadDevice(config.dataDir);
  if (stored === null) {
    console.error(
      `This machine is not paired (no ${deviceFilePath(config.dataDir)}).\n` +
        "Ask for a pairing code, then run `ua-runner pair --code <CODE>`.",
    );
    return 2;
  }

  const credentials: DeviceCredentials = {
    deviceId: stored.deviceId,
    privateKey: stored.privateKey,
  };
  const client = new DeviceClient(config.apiOrigin);
  console.log(`Runner ${RUNNER_VERSION} for ${stored.name} (${stored.deviceId})`);
  console.log(
    `Polling ${config.apiOrigin}, up to ${config.pollWaitSeconds}s per poll. Ctrl+C to stop.`,
  );

  const state: StoredDevice = { ...stored };
  for (;;) {
    let batch: DeviceCommandListResponse;
    try {
      batch = await client.poll(credentials, state.cursor, config.pollWaitSeconds);
    } catch (error) {
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        console.error(
          `The API no longer accepts this device (${error.status} ${error.code}).\n` +
            "It was probably revoked. Re-pair before running here again.",
        );
        return 3;
      }
      console.error(`Poll failed: ${describe(error)} — retrying in ${RETRY_DELAY_MS / 1000}s.`);
      await delay(RETRY_DELAY_MS);
      continue;
    }

    for (const command of batch.commands) {
      const done = await handle(client, credentials, command);
      if (done !== null && done > state.cursor) {
        state.cursor = done;
        saveDevice(config.dataDir, state);
      }
    }
  }
}

function status(config: RunnerConfig): number {
  const device = loadDevice(config.dataDir);
  if (device === null) {
    console.log(`Not paired (no ${deviceFilePath(config.dataDir)}).`);
    return 0;
  }
  console.log(`device id    ${device.deviceId}`);
  console.log(`name         ${device.name}`);
  console.log(`api origin   ${device.apiOrigin}`);
  console.log(`fingerprint  ${device.fingerprint}`);
  console.log(`acked cursor ${device.cursor}`);
  console.log(`identity     ${deviceFilePath(config.dataDir)}`);
  return 0;
}

function describeRoot(state: WorkspaceRootState): string {
  const bits: string[] = [`${state.registered} (${state.writable ? "read-write" : "read-only"})`];
  if (state.resolved !== null && state.resolved !== state.registered) {
    // Show the on-disk spelling if it is different in a way that might matter.
    bits.push(`→ ${state.resolved}`);
  }
  if (state.problem === null) {
    bits.push("usable");
  } else {
    bits.push(`unusable: ${state.problem}`);
  }
  return bits.join(" — ");
}

async function workspaces(config: RunnerConfig): Promise<number> {
  const stored = loadDevice(config.dataDir);
  if (stored === null) {
    console.error(
      `This machine is not paired (no ${deviceFilePath(config.dataDir)}).\n` +
        "Pair it first: `ua-runner pair --code <CODE>`.",
    );
    return 2;
  }

  const credentials: DeviceCredentials = {
    deviceId: stored.deviceId,
    privateKey: stored.privateKey,
  };
  const client = new DeviceClient(config.apiOrigin);
  let policy: Awaited<ReturnType<DeviceClient["workspacePolicy"]>>;
  try {
    policy = await client.workspacePolicy(credentials);
  } catch (error) {
    if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
      console.error(
        `The API no longer accepts this device (${error.status} ${error.code}). Re-pair before continuing.`,
      );
      return 3;
    }
    console.error(`Cannot fetch workspace policy: ${describe(error)}`);
    return 1;
  }

  const flavour = flavourForOs(platform());
  const env = hostEnvironment(process.env, config.dataDir);
  const denied = deniedPaths(flavour, env);
  const states = inspectWorkspaceRoots(policy, { flavour, denied });
  const usable = enforcementRoots(states);

  console.log(`Workspace policy for ${stored.name} (${stored.deviceId}) @ ${config.apiOrigin}`);
  if (policy.workspaces.length === 0) {
    console.log("No workspaces registered for this device.");
  } else {
    console.log("\nRoots:");
    for (const state of states) {
      console.log(`  - ${describeRoot(state)}`);
    }
  }
  if (usable.length > 0) {
    console.log(`\nEnforcement roots (usable): ${usable.length}`);
  }
  if (policy.grants.length > 0) {
    console.log(
      `\nGrants: ${grantRules(policy)
        .map((rule) => `${rule.effect}:${rule.pattern}`)
        .join(", ")}`,
    );
  }
  if (denied.length > 0) {
    console.log(`\nDeny list (machine): ${denied.length} entries`);
  }
  return 0;
}

async function sandboxTest(_config: RunnerConfig): Promise<number> {
  const ctrl = new InMemoryJobObjectController();
  const report = await runSandboxSelfTest({
    flavour: flavourForOs(platform()),
    jobController: ctrl,
    platform: platform(),
  });

  console.log(`Sandbox self-test @ ${report.ranAt}`);
  console.log(`Passed: ${report.passed ? "yes" : "no"}`);
  console.log(`Mutating tools allowed: ${report.allowsMutations ? "yes" : "no"}`);
  console.log("\nChecks:");
  for (const check of report.checks) {
    console.log(`  - [${check.status}] ${check.name}: ${check.message}`);
  }

  if (!report.passed) {
    console.log("\nMutating tools are disabled until the self-test passes.");
    return 1;
  }
  return 0;
}

/**
 * What this machine does with a command.
 *
 * A kind this build does not honour is acknowledged as *failed* rather than
 * left alone: silently ignoring it would leave it pending until it expired, and
 * the API would have no way to tell "never delivered" from "not understood".
 */
function execute(command: DeviceCommandSummary): AckDeviceCommandRequest {
  switch (command.kind) {
    case "diagnostics_ping": {
      // Printed rather than sent: there is no column for a report yet, and the
      // device's own operator is who diagnostics are for (`12` §5.4).
      console.log(
        `[${new Date().toISOString()}] diagnostics ${JSON.stringify(diagnosticsReport())}`,
      );
      return { outcome: "acked" };
    }
    default: {
      const unknown: string = command.kind;
      return { outcome: "failed", error: `unsupported command kind ${unknown}` };
    }
  }
}

/** Returns the acknowledged sequence, or null when the acknowledgement did not land. */
async function handle(
  client: DeviceClient,
  credentials: DeviceCredentials,
  command: DeviceCommandSummary,
): Promise<number | null> {
  const ack = execute(command);
  try {
    await client.ack(credentials, command.id, ack);
  } catch (error) {
    // The command stays `sent` and is re-delivered once the requeue window
    // passes; at-least-once is the contract, so this is a warning, not a stop.
    console.error(`Ack failed for command ${command.id}: ${describe(error)}`);
    return null;
  }
  console.log(`[${new Date().toISOString()}] ${command.kind} #${command.seq}: ${ack.outcome}`);
  return command.seq;
}

async function main(argv: string[]): Promise<number> {
  const { command, flags } = parseArgs(argv);
  if (command === undefined || command === "help" || flags.has("help")) {
    console.log(USAGE);
    return command === undefined ? 2 : 0;
  }

  const config = configFrom(flags);
  switch (command) {
    case "pair":
      return pair(config, flags);
    case "run":
      return run(config);
    case "workspaces":
      return workspaces(config);
    case "sandbox-test":
      return sandboxTest(config);
    case "status":
      return status(config);
    default:
      console.error(`Unknown command "${command}".\n\n${USAGE}`);
      return 2;
  }
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(`ua-runner: ${describe(error)}`);
    process.exitCode = 1;
  });
