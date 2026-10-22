import { arch, cpus, freemem, hostname, platform, release, totalmem, uptime } from "node:os";
import type { DeviceCapabilities } from "@ua/contracts";
import { RUNNER_VERSION } from "./config.js";

/**
 * What this machine can do, reported once at pairing (FR-DEV-02).
 *
 * `commands` is the honest part: it lists what this build will actually run.
 * The model inventory is absent rather than empty — an empty list would read as
 * "nothing installed", and detecting Ollama arrives with the model runtime
 * (docs/planning/17 Phase 4, slice C).
 */
export function capabilityReport(): DeviceCapabilities {
  return {
    commands: ["diagnostics_ping"],
    playwright: false,
  };
}

/**
 * Local telemetry for whoever is sitting at the machine.
 *
 * Not sent to the API: `device_commands` is delivery, not state (docs/planning/06
 * §2.2), so there is nowhere honest to put a report yet. The signal the API
 * does keep is `lastSeenAt`, which the poll itself refreshes.
 */
export function diagnosticsReport(): Record<string, string | number> {
  return {
    platform: platform(),
    osVersion: release(),
    arch: arch(),
    runnerVersion: RUNNER_VERSION,
    nodeVersion: process.version,
    hostname: hostname(),
    cpuCount: cpus().length,
    totalMemoryMb: Math.round(totalmem() / 1024 / 1024),
    freeMemoryMb: Math.round(freemem() / 1024 / 1024),
    uptimeSeconds: Math.round(uptime()),
  };
}
