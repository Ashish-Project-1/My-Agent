import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DeviceWorkspacePolicy, WorkspaceGrantSummary, WorkspaceSummary } from "@ua/contracts";
import { flavourForOs, type PathFlavour } from "@ua/sandbox-manager";
import { afterAll, describe, expect, it } from "vitest";
import {
  enforcementRoots,
  grantRules,
  hostEnvironment,
  type InspectOptions,
  inspectWorkspaceRoots,
} from "../src/workspace-roots.js";

/**
 * These run against the real filesystem, because the whole point of this module
 * is that spelling is not the same thing as a directory (docs/planning/09 §6).
 * A mocked resolver would test the mock.
 */

const flavour: PathFlavour = flavourForOs(process.platform);
const isWindows = flavour === "win32";

// `tmpdir()` itself can be an 8.3 path (C:\Users\RUNNER~1\...), so resolve it
// before making anything inside it or the paths under test start out aliased.
const root = mkdtempSync(join(realpathSync.native(tmpdir()), "ua-roots-"));

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

let counter = 0;
function scratch(name: string): string {
  counter += 1;
  return join(root, `${name}-${counter}`);
}

function workspace(
  path: string,
  mode: "read_only" | "read_write" = "read_write",
): WorkspaceSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    deviceId: "00000000-0000-4000-8000-000000000002",
    path,
    rawPath: path,
    label: "Scratch",
    mode,
    createdByUserId: "00000000-0000-4000-8000-000000000003",
    lastUsedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function grant(pathPattern: string, effect: "allow" | "deny"): WorkspaceGrantSummary {
  return {
    id: "00000000-0000-4000-8000-000000000004",
    workspaceId: "00000000-0000-4000-8000-000000000001",
    pathPattern,
    effect,
    expiresAt: null,
    grantedByUserId: "00000000-0000-4000-8000-000000000003",
    policyVersion: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function policy(
  workspaces: WorkspaceSummary[],
  grants: WorkspaceGrantSummary[] = [],
): DeviceWorkspacePolicy {
  return { workspaces, grants };
}

function inspect(input: DeviceWorkspacePolicy, options: Partial<InspectOptions> = {}) {
  return inspectWorkspaceRoots(input, { flavour, ...options });
}

describe("inspectWorkspaceRoots", () => {
  it("accepts a directory that is really there, and hands it to enforcement", () => {
    const dir = scratch("real");
    mkdirSync(dir, { recursive: true });
    // The on-disk spelling, as the resolver returns it.
    const real = realpathSync.native(dir);

    const [state] = inspect(policy([workspace(real)]));
    expect(state).toMatchObject({ registered: real, resolved: real, problem: null });
    expect(enforcementRoots([state!])).toEqual([{ path: real, writable: true }]);
  });

  it("keeps a read-only root out of write authority but in reach", () => {
    const dir = scratch("readonly");
    mkdirSync(dir, { recursive: true });
    const real = realpathSync.native(dir);

    const [state] = inspect(policy([workspace(real, "read_only")]));
    expect(state?.problem).toBeNull();
    expect(enforcementRoots([state!])).toEqual([{ path: real, writable: false }]);
  });

  it("refuses a root that is not on this machine", () => {
    const gone = join(root, "never-created");
    const [state] = inspect(policy([workspace(gone)]));

    expect(state?.problem).toBe("not found on this machine");
    expect(state?.resolved).toBeNull();
    // An unusable root is not quietly dropped into enforcement: it permits
    // nothing, which is the only safe reading of "we could not check it".
    expect(enforcementRoots([state!])).toEqual([]);
  });

  it("refuses a root that names a file", () => {
    const file = join(root, "a-file.txt");
    writeFileSync(file, "not a directory");
    const [state] = inspect(policy([workspace(file)]));

    expect(state?.problem).toBe("the registered path is not a directory");
    expect(enforcementRoots([state!])).toEqual([]);
  });

  it("refuses a root whose real path leaves the directory that was registered", () => {
    const elsewhere = scratch("elsewhere");
    const link = scratch("link");
    mkdirSync(elsewhere, { recursive: true });
    // A junction on Windows, a directory symlink everywhere else. Both are what
    // a user gets from `mklink /J` or `ln -s`, and both are what `realpath`
    // resolves away — so the check is on the resolved path, not the name.
    symlinkSync(elsewhere, link, isWindows ? "junction" : "dir");

    const [state] = inspect(policy([workspace(link)]));
    expect(state?.resolved).toBe(realpathSync.native(elsewhere));
    expect(state?.problem).toContain("outside the registered directory");
    expect(enforcementRoots([state!])).toEqual([]);
  });

  it("treats a differently-cased spelling as the same directory on Windows", () => {
    if (!isWindows) {
      return;
    }
    const dir = scratch("cased");
    mkdirSync(dir, { recursive: true });
    const real = realpathSync.native(dir);

    const [state] = inspect(policy([workspace(real.toUpperCase())]));
    // `registered` is what the policy said; `resolved` is the disk's answer, and
    // on Windows the two name the same directory.
    expect(state?.problem).toBeNull();
    expect(state?.resolved?.toLowerCase()).toBe(real.toLowerCase());
  });

  it("checks the deny list before the filesystem, so a system path is refused either way", () => {
    const parent = isWindows ? "C:\\Windows" : "/etc";
    const inside = join(parent, "system32", "does-not-exist");
    const [state] = inspect(policy([workspace(inside)]), { denied: [parent] });

    // The deny sentence, not "not found": the verdict must not depend on what
    // happens to exist on this machine.
    expect(state?.problem).toBe("refused: this path is on the deny list");
    expect(state?.resolved).toBeNull();
    expect(enforcementRoots([state!])).toEqual([]);
  });

  it("refuses a root that sits inside a denied directory, however it is spelled", () => {
    const denied = isWindows ? "C:\\Users\\a\\.ssh" : "/home/a/.ssh";
    const [state] = inspect(
      policy([workspace(isWindows ? "C:\\Users\\a\\.ssh\\keys" : "/home/a/.ssh/keys")]),
      { denied: [denied] },
    );
    expect(state?.problem).toBe("refused: this path is on the deny list");
  });

  it("leaves a root that merely contains a denied directory to the target check", () => {
    // A home directory as a root is fine: what is refused is a *target* under
    // `.ssh`, which `checkTargetAllowed` decides per path. Refusing the whole
    // root here would take a user's whole home away for one subdirectory.
    const denied = isWindows ? "C:\\Users\\a\\.ssh" : "/home/a/.ssh";
    const [state] = inspect(policy([workspace(root)]), { denied: [denied] });
    expect(state?.problem).toBeNull();
  });

  it("reports a resolver failure as a missing root rather than throwing", () => {
    const [state] = inspect(policy([workspace(join(root, "whatever"))]), {
      resolve: () => {
        throw new Error("EPERM");
      },
    });
    expect(state?.problem).toBe("not found on this machine");
  });
});

describe("grantRules", () => {
  it("passes grants through in the shape the shared policy compares against", () => {
    const rules = grantRules(
      policy([], [grant("C:\\Users\\a\\inbox", "allow"), grant("F:\\app\\secrets", "deny")]),
    );
    expect(rules).toEqual([
      { pattern: "C:\\Users\\a\\inbox", effect: "allow" },
      { pattern: "F:\\app\\secrets", effect: "deny" },
    ]);
  });
});

describe("hostEnvironment", () => {
  it("reads the machine's directories from the environment", () => {
    const env = {
      WINDIR: "C:\\Windows",
      ProgramFiles: "C:\\Program Files",
      ProgramData: "C:\\ProgramData",
      USERPROFILE: "C:\\Users\\a",
    };
    expect(hostEnvironment(env, "C:\\runner")).toEqual({
      windowsDir: "C:\\Windows",
      programFiles: "C:\\Program Files",
      programData: "C:\\ProgramData",
      userProfile: "C:\\Users\\a",
      runnerDataDir: "C:\\runner",
    });
  });

  it("falls back to the POSIX names", () => {
    expect(hostEnvironment({ HOME: "/home/a" }, "/var/runner")).toMatchObject({
      windowsDir: undefined,
      userProfile: "/home/a",
      runnerDataDir: "/var/runner",
    });
  });
});
