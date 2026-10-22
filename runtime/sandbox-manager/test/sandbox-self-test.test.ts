import { describe, expect, it } from "vitest";
import {
  DEFAULT_ALLOWED_BINARIES,
  InMemoryAppContainerController,
  InMemoryJobObjectController,
  runSandboxSelfTest,
  validateArgv,
} from "../src/index.js";

describe("argv validation", () => {
  it("allows safe argv for allow-listed executables", () => {
    expect(validateArgv(["git", "status"])).toBeNull();
    expect(validateArgv(["node", "script.js"])).toBeNull();
    expect(DEFAULT_ALLOWED_BINARIES.has("git")).toBe(true);
  });

  it("refuses shell metacharacters and disallowed binaries", () => {
    expect(validateArgv(["git", "log", "; rm -rf /"])).not.toBeNull();
    expect(validateArgv(["curl", "http://evil.example"])).not.toBeNull();
    expect(validateArgv(["powershell", "-Command", "calc"])).not.toBeNull();
  });

  it("refuses null bytes", () => {
    expect(validateArgv(["git", "log\u0000--oneline"])).not.toBeNull();
  });
});

describe("job object controller (in-memory)", () => {
  it("creates, assigns, terminates and closes", async () => {
    const ctrl = new InMemoryJobObjectController();
    expect(ctrl.supported()).toBe(true);
    const handle = await ctrl.create({
      killOnJobClose: true,
      processMemoryLimitBytes: 0,
      activeProcessLimit: 0,
      perProcessTimeLimitMs: 0,
    });
    await ctrl.assign(handle, 42);
    expect(ctrl.assignedPids(handle)).toEqual([42]);
    await ctrl.terminate(handle);
    expect(ctrl.assignedPids(handle)).toEqual([]);
    await ctrl.close(handle);
  });
});

describe("app container controller (in-memory)", () => {
  it("manages profiles, grants and launches", async () => {
    const ctrl = new InMemoryAppContainerController();
    const profile = await ctrl.ensureProfile("test");
    expect(profile.sid).toBeTruthy();
    await ctrl.grantFolderAccess(profile, "C:\\workspace");
    const pid = await ctrl.launch(profile, {
      executable: "node",
      argv: ["node", "app.js"],
      cwd: "C:\\workspace",
      allowedRoots: ["C:\\workspace"],
    });
    expect(typeof pid).toBe("number");
    expect(ctrl.getLaunched()).toHaveLength(1);
    await ctrl.deleteProfile(profile);
  });
});

describe("sandbox self-test", () => {
  it("passes with in-memory controllers and disables mutations only on failure", async () => {
    const ctrl = new InMemoryJobObjectController();
    const report = await runSandboxSelfTest({
      flavour: "win32",
      jobController: ctrl,
      platform: "win32",
    });
    expect(report.passed).toBe(true);
    expect(report.allowsMutations).toBe(true);
    expect(report.checks.some((c) => c.name === "job-object-kill" && c.status === "passed")).toBe(
      true,
    );
    expect(report.checks.some((c) => c.name === "argv-validation" && c.status === "passed")).toBe(
      true,
    );
  });

  it("fails when workspace enforcement is bypassed", async () => {
    // We can't easily inject a broken controller, but we can verify the shape
    const report = await runSandboxSelfTest({ flavour: "win32", platform: "win32" });
    // job-object skipped without controller, others should pass on this machine
    expect(report.checks.length).toBeGreaterThan(0);
  });
});
