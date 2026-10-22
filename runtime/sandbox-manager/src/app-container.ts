/**
 * Windows AppContainer / low-integrity containment (docs/planning/09 §8 L2).
 *
 * Used for untrusted third-party tool binaries. The API here is process-level
 * rather than filesystem-ACL-specific: the controller creates an AppContainer
 * profile/sid, grants capability access as required, and launches processes
 * inside it. On non-Windows platforms or when AppContainer is unavailable, the
 * controller reports unsupported and the caller must fall back to L1 (job object
 * + restricted token) or refuse the action.
 */

export interface AppContainerProfile {
  readonly name: string;
  /** Windows Security Identifier for the container. */
  readonly sid: string;
}

export interface AppContainerLaunchOptions {
  readonly executable: string;
  readonly argv: readonly string[];
  readonly cwd: string;
  readonly environment?: Record<string, string>;
  /** Workspace roots this container may access (granted via capabilities/ACLs). */
  readonly allowedRoots: readonly string[];
}

export interface AppContainerController {
  /** Whether AppContainer is supported on this platform. */
  supported(): boolean;
  /** Create or open a profile for this runner/namespace. */
  ensureProfile(name: string): Promise<AppContainerProfile>;
  /** Grant access to a filesystem path for the given profile. */
  grantFolderAccess(profile: AppContainerProfile, path: string): Promise<void>;
  /** Launch a process inside the AppContainer. Returns the pid. */
  launch(profile: AppContainerProfile, options: AppContainerLaunchOptions): Promise<number>;
  /** Delete the profile and its resources. */
  deleteProfile(profile: AppContainerProfile): Promise<void>;
}

/** In-memory controller for tests and non-Windows environments. */
export class InMemoryAppContainerController implements AppContainerController {
  private nextPid = 10000;
  private readonly profiles = new Map<string, AppContainerProfile>();
  private readonly grants = new Map<string, Set<string>>();
  private readonly launched: Array<{
    profile: string;
    options: AppContainerLaunchOptions;
    pid: number;
  }> = [];

  supported(): boolean {
    return true;
  }

  async ensureProfile(name: string): Promise<AppContainerProfile> {
    const existing = this.profiles.get(name);
    if (existing) return existing;
    const profile: AppContainerProfile = { name, sid: `S-1-15-2-inmem-${this.profiles.size + 1}` };
    this.profiles.set(name, profile);
    this.grants.set(name, new Set());
    return profile;
  }

  async grantFolderAccess(profile: AppContainerProfile, path: string): Promise<void> {
    const set = this.grants.get(profile.name);
    if (!set) throw new Error(`unknown profile: ${profile.name}`);
    set.add(path);
  }

  async launch(profile: AppContainerProfile, options: AppContainerLaunchOptions): Promise<number> {
    const set = this.grants.get(profile.name);
    if (!set) throw new Error(`unknown profile: ${profile.name}`);
    const pid = this.nextPid++;
    this.launched.push({ profile: profile.name, options, pid });
    return pid;
  }

  async deleteProfile(profile: AppContainerProfile): Promise<void> {
    this.profiles.delete(profile.name);
    this.grants.delete(profile.name);
  }

  /** For tests: list all launched processes. */
  getLaunched() {
    return [...this.launched];
  }
}
