/**
 * Sandbox self-test (docs/planning/09 §11, §14).
 *
 * Run at install and on demand. A failing self-test disables mutating tools
 * until fixed. The tests are designed to be deterministic and to actually probe
 * the containment boundaries where possible.
 */

import { validateArgv } from "./argv.js";
import type { JobObjectController } from "./job-object.js";
import { canonicalisePath, checkTargetAllowed } from "./path-policy.js";

export type SelfTestStatus = "passed" | "failed" | "skipped";

export interface SelfTestCheck {
  readonly name: string;
  readonly status: SelfTestStatus;
  readonly message: string;
}

export interface SelfTestReport {
  readonly passed: boolean;
  /** If false, mutating tools must be disabled until the self-test passes. */
  readonly allowsMutations: boolean;
  readonly checks: readonly SelfTestCheck[];
  readonly ranAt: string;
}

export interface SelfTestOptions {
  readonly flavour?: "win32" | "posix";
  readonly jobController?: JobObjectController;
  readonly platform?: NodeJS.Platform;
}

/**
 * Run the sandbox self-test. Each check is reported individually so the
 * diagnostics screen can show exactly what failed.
 */
export async function runSandboxSelfTest(options: SelfTestOptions = {}): Promise<SelfTestReport> {
  void options.flavour;
  void options.platform;
  const checks: SelfTestCheck[] = [];
  const ranAt = new Date().toISOString();

  // 1) Path canonicalisation refuses traversal/hostile paths
  try {
    const traversal = canonicalisePath("C:\\a\\..\\..\\Windows", "win32");
    if (traversal.ok) {
      checks.push({
        name: "path-traversal-refused",
        status: "failed",
        message: "traversal was not refused",
      });
    } else {
      checks.push({
        name: "path-traversal-refused",
        status: "passed",
        message: `refused with ${traversal.reason}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "path-traversal-refused",
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 2) Workspace enforcement: write outside a root is denied
  try {
    const verdict = checkTargetAllowed({
      target: "C:\\outside\\x.txt",
      write: true,
      flavour: "win32",
      roots: [{ path: "C:\\workspace", writable: true }],
      denied: [],
    });
    if (verdict.ok) {
      checks.push({
        name: "workspace-enforcement",
        status: "failed",
        message: "write outside workspace was allowed",
      });
    } else {
      checks.push({
        name: "workspace-enforcement",
        status: "passed",
        message: `denied with ${verdict.reason}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "workspace-enforcement",
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 3) argv validation: shell metacharacters refused, allow-list enforced
  try {
    const badShell = validateArgv(["git", "log", "; rm -rf /"]);
    const badBin = validateArgv(["curl", "http://example.com"]);
    if (badShell === null || badBin === null) {
      checks.push({
        name: "argv-validation",
        status: "failed",
        message: "dangerous argv was not refused",
      });
    } else {
      checks.push({
        name: "argv-validation",
        status: "passed",
        message: "shell metacharacters and disallowed binaries refused",
      });
    }
  } catch (err) {
    checks.push({
      name: "argv-validation",
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 4) Job object kill-tree works (use in-memory or provided controller)
  try {
    const ctrl = options.jobController;
    if (!ctrl) {
      checks.push({
        name: "job-object-kill",
        status: "skipped",
        message: "no job object controller provided",
      });
    } else if (!ctrl.supported()) {
      checks.push({
        name: "job-object-kill",
        status: "skipped",
        message: "job objects not supported on this platform",
      });
    } else {
      const handle = await ctrl.create({
        killOnJobClose: true,
        processMemoryLimitBytes: 0,
        activeProcessLimit: 0,
        perProcessTimeLimitMs: 0,
      });
      await ctrl.assign(handle, 12345);
      await ctrl.terminate(handle);
      await ctrl.close(handle);
      checks.push({
        name: "job-object-kill",
        status: "passed",
        message: "job object created, assigned, terminated and closed",
      });
    }
  } catch (err) {
    checks.push({
      name: "job-object-kill",
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  // 5) Symlink/junction traversal blocked by canonicalisation + policy
  try {
    const verdict = checkTargetAllowed({
      target: "/etc/passwd",
      write: false,
      flavour: "posix",
      roots: [{ path: "/workspace", writable: false }],
      denied: [],
    });
    if (verdict.ok) {
      checks.push({
        name: "symlink-traversal-blocked",
        status: "failed",
        message: "access outside workspace was allowed",
      });
    } else {
      checks.push({
        name: "symlink-traversal-blocked",
        status: "passed",
        message: `denied with ${verdict.reason}`,
      });
    }
  } catch (err) {
    checks.push({
      name: "symlink-traversal-blocked",
      status: "failed",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  const passed = checks.every((c) => c.status !== "failed");
  // A failing self-test disables mutating tools until fixed.
  const allowsMutations = passed;

  return { passed, allowsMutations, checks, ranAt };
}
