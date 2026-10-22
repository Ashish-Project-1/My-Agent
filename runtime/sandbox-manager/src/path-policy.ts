/**
 * The workspace path policy (docs/planning/09 §6, `11` T-LOC-02).
 *
 * One implementation, used by both sides of the boundary. The API runs it on a
 * path a member typed, because the registry is what decides which roots exist at
 * all — a root nobody validated is a root the runner would happily allow. The
 * runner runs it before touching the filesystem, because it is the side that
 * knows the machine. Two copies of this logic would be two chances to get one of
 * the escape vectors wrong.
 *
 * Deliberately pure and filesystem-free: nothing here stats, opens or resolves
 * anything. `..` is folded by string arithmetic, and a path that has not already
 * been resolved on the real machine is refused rather than trusted — see
 * `checkTargetAllowed`'s `not_canonical` verdict. Resolution (symlinks,
 * junctions, 8.3 short names, on-disk casing) is `fs.realpath`'s job, and it is
 * the caller's job to run it first, because only the caller has a filesystem.
 */

/** Which path grammar applies. Not the API's own OS: it is the *device's*. */
export type PathFlavour = "win32" | "posix";

/** `devices.os` → the grammar its paths are written in (docs/planning/06 §2.2). */
export function flavourForOs(os: string): PathFlavour {
  return os.toLowerCase() === "win32" ? "win32" : "posix";
}

export type PathRejectReason =
  | "empty"
  | "too_long"
  | "control_character"
  | "not_absolute"
  | "unc_path"
  | "device_path"
  | "alternate_data_stream"
  | "traversal"
  | "reserved_name"
  | "trailing_dot_or_space";

export type PathVerdict =
  | { readonly ok: true; readonly canonicalPath: string }
  | { readonly ok: false; readonly reason: PathRejectReason };

/**
 * Windows paths beyond this are refused as input, well before `MAX_PATH`
 * territory. The column is text, so this bounds what a client can make us store
 * and compare, not what the filesystem can hold.
 */
const MAX_PATH_LENGTH = 4096;

/**
 * Device names that name hardware, not a file, whatever directory they appear
 * in: `C:\anywhere\NUL` is the null device, and opening it is not a file open.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "conin$",
  "conout$",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

const DRIVE_ROOT = /^[A-Za-z]:[\\/]$/;

/** A control character anywhere makes the string a different path than it reads. */
function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/**
 * Folds `.` and `..` over already-split components.
 *
 * `..` above the start is a refusal, not a clamp: `F:\..\Windows` collapsing to
 * `F:\Windows` would look contained while naming something else entirely.
 */
function foldComponents(components: readonly string[]): string[] | PathRejectReason {
  const stack: string[] = [];
  for (const component of components) {
    if (component === ".") {
      continue;
    }
    if (component === "..") {
      if (stack.length === 0) {
        return "traversal";
      }
      stack.pop();
      continue;
    }
    stack.push(component);
  }
  return stack;
}

function windowsComponentReason(component: string): PathRejectReason | null {
  // Win32 strips these before opening, so `F:\x.` and `F:\x ` are aliases of
  // `F:\x` — a comparison that keeps them is a comparison that can be fooled.
  if (component.endsWith(".") || component.endsWith(" ")) {
    return "trailing_dot_or_space";
  }
  const stem = (component.split(".", 1)[0] ?? "").toLowerCase();
  return WINDOWS_RESERVED_NAMES.has(stem) ? "reserved_name" : null;
}

function canonicaliseWindows(raw: string): PathVerdict {
  // Verbatim (`\\?\`) and device (`\\.\`) prefixes both leave the normal Win32
  // path rules behind — no `..` folding, no canonical name — so they are refused
  // rather than half-understood.
  if (raw.startsWith("\\\\?\\") || raw.startsWith("\\\\.\\")) {
    return { ok: false, reason: "device_path" };
  }
  if (raw.startsWith("\\\\") || raw.startsWith("//")) {
    return { ok: false, reason: "unc_path" };
  }
  // `C:foo` is relative to the drive's current directory and `\Windows` to the
  // current drive's root: neither names one location without more context.
  if (!/^[A-Za-z]:[\\/]/.test(raw)) {
    return { ok: false, reason: "not_absolute" };
  }
  // The drive colon is at index 1; any other colon from there on is a stream.
  if (raw.slice(2).includes(":")) {
    return { ok: false, reason: "alternate_data_stream" };
  }

  const components = raw.slice(3).split(/[\\/]+/);
  const body: string[] = [];
  for (const component of components) {
    // A trailing or doubled separator is not a component.
    if (component === "") {
      continue;
    }
    // `.` and `..` are structure, not names, so the name rules do not apply —
    // `..` in particular ends in a dot without being a trailing-dot alias.
    if (component === "." || component === "..") {
      body.push(component);
      continue;
    }
    const reason = windowsComponentReason(component);
    if (reason !== null) {
      return { ok: false, reason };
    }
    body.push(component);
  }

  const folded = foldComponents(body);
  if (typeof folded === "string") {
    return { ok: false, reason: folded };
  }
  const head = `${(raw[0] ?? "").toUpperCase()}:\\`;
  return { ok: true, canonicalPath: `${head}${folded.join("\\")}` };
}

function canonicalisePosix(raw: string): PathVerdict {
  // `//host/share` is implementation-defined by POSIX and a UNC path in
  // practice; refusing it is the only reading that holds everywhere.
  if (raw.startsWith("//")) {
    return { ok: false, reason: "unc_path" };
  }
  if (!raw.startsWith("/")) {
    return { ok: false, reason: "not_absolute" };
  }

  const components = raw.split("/").filter((component) => component !== "");
  const folded = foldComponents(components);
  if (typeof folded === "string") {
    return { ok: false, reason: folded };
  }
  return { ok: true, canonicalPath: `/${folded.join("/")}` };
}

/**
 * The one canonical form of a path, or the reason it has none.
 *
 * "Canonical" here means syntactic: one spelling, one set of components, no
 * clamps. The result is what belongs in `workspaces.path` (docs/planning/06 §2.2)
 * and what every later comparison uses.
 */
export function canonicalisePath(raw: string, flavour: PathFlavour): PathVerdict {
  if (raw === "") {
    return { ok: false, reason: "empty" };
  }
  if (raw.length > MAX_PATH_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (hasControlCharacter(raw)) {
    return { ok: false, reason: "control_character" };
  }
  return flavour === "win32" ? canonicaliseWindows(raw) : canonicalisePosix(raw);
}

const SEPARATOR: Record<PathFlavour, string> = { win32: "\\", posix: "/" };

/**
 * Windows compares case-insensitively and POSIX does not. Both comparisons below
 * are character-wise: `F:\Project` is not an ancestor of `F:\Projects`, which a
 * bare `startsWith` on the root would claim it was.
 */
function comparable(value: string, flavour: PathFlavour): string {
  return flavour === "win32" ? value.toLowerCase() : value;
}

function withoutTrailingSeparator(path: string, flavour: PathFlavour): string {
  if (path === SEPARATOR[flavour] || DRIVE_ROOT.test(path)) {
    return path;
  }
  let end = path.length;
  while (end > 1 && path[end - 1] === SEPARATOR[flavour]) {
    end -= 1;
  }
  return path.slice(0, end);
}

/** True when `target` is `root` itself or lies below it. Both must be canonical. */
export function isWithin(root: string, target: string, flavour: PathFlavour): boolean {
  const base = comparable(withoutTrailingSeparator(root, flavour), flavour);
  const candidate = comparable(withoutTrailingSeparator(target, flavour), flavour);
  if (base === candidate) {
    return true;
  }
  const separator = SEPARATOR[flavour];
  const prefix = base.endsWith(separator) ? base : base + separator;
  return candidate.startsWith(prefix);
}

/** A directory the agent may work in, with the authority the user gave it. */
export interface WorkspaceRoot {
  readonly path: string;
  readonly writable: boolean;
}

/**
 * An `external_directory` grant (docs/planning/09 §6, `06` §2.2). The pattern is
 * a directory, not a glob: it covers the directory itself and everything below
 * it, and nothing else. Globs invite a matcher bug at exactly the wrong moment.
 */
export interface PathPatternRule {
  readonly pattern: string;
  readonly effect: "allow" | "deny";
}

export type TargetRefusal = "not_canonical" | "denied_path" | "outside_workspace" | "read_only";

export type TargetVerdict =
  | {
      readonly ok: true;
      /** The root that allowed it, or null when a grant did. */
      readonly root: string | null;
      readonly viaGrant: boolean;
      readonly writable: boolean;
    }
  | { readonly ok: false; readonly reason: TargetRefusal };

export interface TargetCheck {
  /** Resolved on the real machine already — `fs.realpath`, not `canonicalisePath` alone. */
  readonly target: string;
  readonly write: boolean;
  readonly flavour: PathFlavour;
  readonly roots: readonly WorkspaceRoot[];
  readonly grants?: readonly PathPatternRule[];
  /**
   * Absolute, canonical paths refused wherever they sit (docs/planning/09 §6).
   * Built from the machine's own environment by `deniedPaths`, because `%WINDIR%`
   * is not a fact the API can know.
   */
  readonly denied?: readonly string[];
}

function matches(rule: PathPatternRule, target: string, flavour: PathFlavour): boolean {
  return isWithin(rule.pattern, target, flavour);
}

/**
 * May the agent touch this path, and how?
 *
 * The order is the part worth reading twice. A target must already be resolved
 * (`not_canonical` otherwise): a check that folds `..` itself would be checking a
 * different string from the one the syscall gets, and symlinks and junctions are
 * invisible to string arithmetic. Refusals beat grants, a deny grant beats an
 * allow grant, and a root that permits the operation beats a grant that does not
 * — so adding a grant can never widen what a root already refused.
 */
export function checkTargetAllowed(input: TargetCheck): TargetVerdict {
  const { flavour, target } = input;

  const canonical = canonicalisePath(target, flavour);
  if (!canonical.ok || canonical.canonicalPath !== target) {
    return { ok: false, reason: "not_canonical" };
  }

  for (const denied of input.denied ?? []) {
    if (isWithin(denied, target, flavour)) {
      return { ok: false, reason: "denied_path" };
    }
  }

  const grants = input.grants ?? [];
  if (grants.some((grant) => grant.effect === "deny" && matches(grant, target, flavour))) {
    return { ok: false, reason: "denied_path" };
  }

  const containing = input.roots.filter((root) => isWithin(root.path, target, flavour));
  const permitted = containing.find((root) => root.writable || !input.write);
  if (permitted !== undefined) {
    return {
      ok: true,
      root: permitted.path,
      viaGrant: false,
      writable: permitted.writable,
    };
  }

  if (grants.some((grant) => grant.effect === "allow" && matches(grant, target, flavour))) {
    return { ok: true, root: null, viaGrant: true, writable: true };
  }

  return { ok: false, reason: containing.length > 0 ? "read_only" : "outside_workspace" };
}

/** What the machine itself knows about where its own sensitive directories are. */
export interface HostEnvironment {
  readonly windowsDir?: string | undefined;
  readonly programFiles?: string | undefined;
  readonly programData?: string | undefined;
  readonly userProfile?: string | undefined;
  /** Where this runner keeps its own state: its key, its config, its logs. */
  readonly runnerDataDir?: string | undefined;
}

/**
 * The always-deny list (docs/planning/09 §6), as far as this build can know it.
 *
 * `shortcut: the browser profile stores and the OS credential store are not
 * listed yet — both need a discovery step that arrives with the browser runtime
 * (Phase 4 slice C). Until then they are refused only by not being inside a root,
 * and the deny list here is the part that is knowable today.`
 */
export function deniedPaths(flavour: PathFlavour, env: HostEnvironment): string[] {
  const candidates: Array<string | undefined> =
    flavour === "win32"
      ? [
          env.windowsDir,
          env.programFiles,
          env.programData === undefined ? undefined : `${env.programData}\\opencode`,
          env.userProfile === undefined ? undefined : `${env.userProfile}\\.ssh`,
          env.userProfile === undefined ? undefined : `${env.userProfile}\\.aws`,
          env.runnerDataDir,
        ]
      : [
          env.userProfile === undefined ? undefined : `${env.userProfile}/.ssh`,
          env.userProfile === undefined ? undefined : `${env.userProfile}/.aws`,
          env.runnerDataDir,
        ];

  const denied: string[] = [];
  for (const candidate of candidates) {
    if (candidate === undefined) {
      continue;
    }
    const canonical = canonicalisePath(candidate, flavour);
    if (canonical.ok) {
      denied.push(canonical.canonicalPath);
    }
  }
  return denied;
}
