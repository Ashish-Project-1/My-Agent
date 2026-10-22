import { realpathSync, statSync } from "node:fs";
import type { DeviceWorkspacePolicy } from "@ua/contracts";
import {
  type HostEnvironment,
  isWithin,
  type PathFlavour,
  type PathPatternRule,
  type WorkspaceRoot,
} from "@ua/sandbox-manager";

/**
 * The device's own half of the workspace policy (FR-DEV-05, docs/planning/09 §6).
 *
 * The API stores a *string* — it has no filesystem to check it against, so it can
 * only judge spelling. This is where a registered root meets the machine: it is
 * resolved (`fs.realpath`, which follows symlinks and junctions, expands 8.3
 * short names and returns the on-disk casing), and a root that does not survive
 * that is refused rather than trusted.
 *
 * Fail-closed in both directions. A root that is missing, that names something
 * other than a directory, that is on the deny list, or whose real path leaves the
 * directory that was registered, is reported as unusable and is *not* handed to
 * the enforcement check — an unusable root that silently became an empty one
 * would turn a mistake into a boundary that permits nothing, which is at least
 * the right way round, but one that became the *link target* would be worse.
 */

/** A registered root as this machine sees it. */
export interface WorkspaceRootState {
  readonly id: string;
  readonly label: string;
  /** The canonical path the API stored and every comparison uses. */
  readonly registered: string;
  /** Where `registered` actually points on this machine; null when it is not there. */
  readonly resolved: string | null;
  readonly writable: boolean;
  /** Null when the root is usable, else the sentence to show the operator. */
  readonly problem: string | null;
}

export interface InspectOptions {
  readonly flavour: PathFlavour;
  /** Absolute canonical paths refused wherever they sit (`deniedPaths`). */
  readonly denied?: readonly string[];
  /** Injected in tests. Defaults to the platform's own resolver. */
  readonly resolve?: (path: string) => string;
  readonly isDirectory?: (path: string) => boolean;
}

function platformResolve(path: string): string {
  // `.native` on Windows goes through the OS call, so a junction, a symlink, an
  // 8.3 short name and a differently-cased spelling all come back as one path.
  return realpathSync.native(path);
}

function platformIsDirectory(path: string): boolean {
  return statSync(path).isDirectory();
}

/**
 * Resolve every registered root against this machine.
 *
 * Nothing here throws: a root that cannot be checked is a root that cannot be
 * used, and the operator needs to be told which one and why. The deny list is
 * checked first, before the filesystem, so the verdict for a system directory is
 * the same on a machine where it exists and one where it does not.
 */
export function inspectWorkspaceRoots(
  policy: DeviceWorkspacePolicy,
  options: InspectOptions,
): WorkspaceRootState[] {
  const resolve = options.resolve ?? platformResolve;
  const isDirectory = options.isDirectory ?? platformIsDirectory;

  return policy.workspaces.map((workspace) => {
    const base = {
      id: workspace.id,
      label: workspace.label,
      registered: workspace.path,
      writable: workspace.mode === "read_write",
    };

    const denied = (options.denied ?? []).some((path) =>
      isWithin(path, workspace.path, options.flavour),
    );
    if (denied) {
      return { ...base, resolved: null, problem: "refused: this path is on the deny list" };
    }

    let resolved: string;
    try {
      resolved = resolve(workspace.path);
    } catch {
      return { ...base, resolved: null, problem: "not found on this machine" };
    }

    try {
      if (!isDirectory(resolved)) {
        return { ...base, resolved, problem: "the registered path is not a directory" };
      }
    } catch {
      return { ...base, resolved: null, problem: "not found on this machine" };
    }

    // `isWithin` is case-insensitive on Windows, so a root spelled with different
    // case is the same root. Anything else means the path name reaches a
    // different directory than the one that was registered.
    if (!isWithin(workspace.path, resolved, options.flavour)) {
      return {
        ...base,
        resolved,
        problem: `resolves to ${resolved}, outside the registered directory — register that path instead`,
      };
    }

    return { ...base, resolved, problem: null };
  });
}

/** The roots the enforcement check may use. An unusable root permits nothing. */
export function enforcementRoots(states: readonly WorkspaceRootState[]): WorkspaceRoot[] {
  return states
    .filter((state) => state.problem === null && state.resolved !== null)
    .map((state) => ({ path: state.resolved as string, writable: state.writable }));
}

/** The standing grants, in the shape the shared path policy compares against. */
export function grantRules(policy: DeviceWorkspacePolicy): PathPatternRule[] {
  return policy.grants.map((grant) => ({ pattern: grant.pathPattern, effect: grant.effect }));
}

/**
 * Where *this* machine keeps the things that are always out of bounds.
 *
 * A fact the API cannot know, which is why the deny list is built here rather
 * than stored (docs/planning/09 §6). `env` is a parameter so a test can place a
 * machine somewhere other than the one it is running on.
 */
export function hostEnvironment(env: NodeJS.ProcessEnv, dataDir: string): HostEnvironment {
  return {
    windowsDir: env.WINDIR ?? env.SystemRoot,
    programFiles: env.ProgramFiles,
    programData: env.ProgramData ?? env.ALLUSERSPROFILE,
    userProfile: env.USERPROFILE ?? env.HOME,
    runnerDataDir: dataDir,
  };
}
