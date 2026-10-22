import { describe, expect, it } from "vitest";
import {
  canonicalisePath,
  checkTargetAllowed,
  deniedPaths,
  flavourForOs,
  isWithin,
  type PathFlavour,
  type PathRejectReason,
  type WorkspaceRoot,
} from "../src/index.js";

/**
 * The Windows path matrix (docs/planning/09 §14) plus its POSIX twin.
 *
 * Every case names a real escape from docs/planning/09 §6, and every refusal is
 * asserted by reason rather than by "some error", so a change that starts
 * refusing the wrong thing cannot hide behind a passing test.
 */
function canonical(raw: string, flavour: PathFlavour): string {
  const verdict = canonicalisePath(raw, flavour);
  if (!verdict.ok) {
    throw new Error(`expected ${raw} to be canonical, got ${verdict.reason}`);
  }
  return verdict.canonicalPath;
}

function refusal(raw: string, flavour: PathFlavour): PathRejectReason {
  const verdict = canonicalisePath(raw, flavour);
  if (verdict.ok) {
    throw new Error(`expected ${raw} to be refused, got ${verdict.canonicalPath}`);
  }
  return verdict.reason;
}

describe("canonical path (docs/planning/09 §6)", () => {
  it("keeps one spelling of a Windows path", () => {
    expect(canonical("F:\\My Project\\My Agent", "win32")).toBe("F:\\My Project\\My Agent");
    // Separators, drive case and redundant components all fold to the same form.
    expect(canonical("f:/My Project/My Agent", "win32")).toBe("F:\\My Project\\My Agent");
    expect(canonical("F:\\My Project\\.\\My Agent\\", "win32")).toBe("F:\\My Project\\My Agent");
    expect(canonical("F:\\My Project\\\\My Agent", "win32")).toBe("F:\\My Project\\My Agent");
    expect(canonical("F:\\a\\..\\b", "win32")).toBe("F:\\b");
    expect(canonical("C:\\", "win32")).toBe("C:\\");
    expect(canonical("C:\\a\\.", "win32")).toBe("C:\\a");
  });

  it("keeps one spelling of a POSIX path", () => {
    expect(canonical("/srv/data", "posix")).toBe("/srv/data");
    expect(canonical("/srv/./a//b/", "posix")).toBe("/srv/a/b");
    expect(canonical("/srv/a/../b", "posix")).toBe("/srv/b");
    expect(canonical("/", "posix")).toBe("/");
  });

  it("refuses traversal above the root instead of clamping it", () => {
    // Clamping `F:\..\Windows` to `F:\Windows` would look contained while naming
    // something else, which is the whole trick.
    expect(refusal("F:\\..\\Windows", "win32")).toBe("traversal");
    expect(refusal("F:\\a\\..\\..\\b", "win32")).toBe("traversal");
    expect(refusal("/srv/../../etc", "posix")).toBe("traversal");
    expect(refusal("/..", "posix")).toBe("traversal");
  });

  it("refuses UNC, verbatim, device and drive-relative paths", () => {
    expect(refusal("\\\\server\\share\\x", "win32")).toBe("unc_path");
    expect(refusal("//server/share/x", "win32")).toBe("unc_path");
    expect(refusal("//server/share/x", "posix")).toBe("unc_path");
    expect(refusal("\\\\?\\C:\\x", "win32")).toBe("device_path");
    expect(refusal("\\\\.\\PHYSICALDRIVE0", "win32")).toBe("device_path");
    // `C:temp` reads the drive's current directory: not one location.
    expect(refusal("C:temp", "win32")).toBe("not_absolute");
    expect(refusal("\\Windows", "win32")).toBe("not_absolute");
    expect(refusal("srv/data", "posix")).toBe("not_absolute");
    expect(refusal("", "win32")).toBe("empty");
  });

  it("refuses alternate data streams and reserved device names", () => {
    expect(refusal("C:\\Windows\\notepad.exe:hidden", "win32")).toBe("alternate_data_stream");
    expect(refusal("C:\\a:b", "win32")).toBe("alternate_data_stream");
    // A reserved name names hardware wherever it appears, extension or not.
    expect(refusal("F:\\a\\NUL\\b", "win32")).toBe("reserved_name");
    expect(refusal("F:\\con.txt", "win32")).toBe("reserved_name");
    expect(refusal("F:\\LPT1", "win32")).toBe("reserved_name");
    // The same names are ordinary files elsewhere, which is why this is
    // flavour-specific rather than global.
    expect(canonical("/srv/nul", "posix")).toBe("/srv/nul");
  });

  it("refuses names Win32 would silently strip or alias", () => {
    expect(refusal("F:\\a. ", "win32")).toBe("trailing_dot_or_space");
    expect(refusal("F:\\a \\b", "win32")).toBe("trailing_dot_or_space");
    expect(refusal("F:\\a\\...", "win32")).toBe("trailing_dot_or_space");
    expect(canonical("/srv/a. ", "posix")).toBe("/srv/a. ");
  });

  it("refuses a path carrying a control character", () => {
    expect(refusal("C:\\a\u0000b", "win32")).toBe("control_character");
    expect(refusal("C:\\a\nb", "win32")).toBe("control_character");
    expect(refusal("F:\\a".padEnd(4100, "b"), "win32")).toBe("too_long");
  });

  it("reads the grammar from the device's OS, not the caller's", () => {
    expect(flavourForOs("win32")).toBe("win32");
    expect(flavourForOs("WIN32")).toBe("win32");
    expect(flavourForOs("linux")).toBe("posix");
    expect(flavourForOs("darwin")).toBe("posix");
  });
});

describe("containment", () => {
  it("compares whole components, not string prefixes", () => {
    expect(isWithin("F:\\Project", "F:\\Project\\src", "win32")).toBe(true);
    expect(isWithin("F:\\Project", "F:\\Project", "win32")).toBe(true);
    expect(isWithin("F:\\Project\\", "F:\\Project\\src", "win32")).toBe(true);
    // A bare prefix match would call this contained.
    expect(isWithin("F:\\Project", "F:\\Projects", "win32")).toBe(false);
    expect(isWithin("F:\\Project", "F:\\", "win32")).toBe(false);
    expect(isWithin("C:\\", "C:\\Windows", "win32")).toBe(true);
  });

  it("is case-insensitive on Windows and case-sensitive elsewhere", () => {
    // Windows folds case, so two spellings are one directory and both must be
    // recognised as contained.
    expect(isWithin("F:\\Project", "f:\\PROJECT\\SRC", "win32")).toBe(true);
    expect(isWithin("/srv/Project", "/srv/project/src", "posix")).toBe(false);
  });
});

const ROOT: WorkspaceRoot = { path: "F:\\Project", writable: true };
const READ_ONLY: WorkspaceRoot = { path: "F:\\Project\\docs", writable: false };

describe("target check", () => {
  it("allows a read and a write inside a read-write root", () => {
    expect(
      checkTargetAllowed({
        target: "F:\\Project\\src\\index.ts",
        write: true,
        flavour: "win32",
        roots: [ROOT],
      }),
    ).toEqual({ ok: true, root: "F:\\Project", viaGrant: false, writable: true });
  });

  it("refuses a write inside a read-only root but allows the read", () => {
    expect(
      checkTargetAllowed({
        target: "F:\\Project\\docs\\a.md",
        write: true,
        flavour: "win32",
        roots: [ROOT, READ_ONLY],
      }),
    ).toEqual({ ok: true, root: "F:\\Project", viaGrant: false, writable: true });

    const onlyReadOnly = checkTargetAllowed({
      target: "F:\\Project\\docs\\a.md",
      write: true,
      flavour: "win32",
      roots: [READ_ONLY],
    });
    expect(onlyReadOnly).toEqual({ ok: false, reason: "read_only" });
    expect(
      checkTargetAllowed({
        target: "F:\\Project\\docs\\a.md",
        write: false,
        flavour: "win32",
        roots: [READ_ONLY],
      }),
    ).toEqual({ ok: true, root: "F:\\Project\\docs", viaGrant: false, writable: false });
  });

  it("refuses a target that has not been resolved on the machine", () => {
    // `checkTargetAllowed` does not fold `..` itself: a check that resolved a
    // different string from the one the syscall gets is not a check.
    for (const target of [
      "F:\\Project\\..\\Windows",
      "F:\\Project\\",
      "F:\\Project\\a\\b\\..\\c",
    ]) {
      expect(checkTargetAllowed({ target, write: false, flavour: "win32", roots: [ROOT] })).toEqual(
        { ok: false, reason: "not_canonical" },
      );
    }
  });

  it("refuses anything outside the roots", () => {
    expect(
      checkTargetAllowed({
        target: "F:\\Elsewhere\\a",
        write: false,
        flavour: "win32",
        roots: [ROOT],
      }),
    ).toEqual({ ok: false, reason: "outside_workspace" });
  });

  it("lets an allow grant reach outside a root, and a deny grant veto the inside", () => {
    const grants = [{ pattern: "C:\\Users\\a\\Documents\\inbox", effect: "allow" as const }];
    expect(
      checkTargetAllowed({
        target: "C:\\Users\\a\\Documents\\inbox\\today.md",
        write: true,
        flavour: "win32",
        roots: [ROOT],
        grants,
      }),
    ).toEqual({ ok: true, root: null, viaGrant: true, writable: true });

    // A deny grant over everything beats both a root and an allow grant: adding
    // a rule may never widen what was already refused.
    expect(
      checkTargetAllowed({
        target: "F:\\Project\\secrets\\a",
        write: false,
        flavour: "win32",
        roots: [ROOT],
        grants: [
          { pattern: "F:\\Project", effect: "allow" },
          { pattern: "F:\\Project\\secrets", effect: "deny" },
        ],
      }),
    ).toEqual({ ok: false, reason: "denied_path" });
  });

  it("refuses a denied path even inside a registered root", () => {
    // The deny list is checked before the roots, so registering a directory that
    // contains one does not open it.
    expect(
      checkTargetAllowed({
        target: "C:\\Windows\\System32\\drivers\\etc\\hosts",
        write: false,
        flavour: "win32",
        roots: [{ path: "C:\\", writable: true }],
        denied: ["C:\\Windows"],
      }),
    ).toEqual({ ok: false, reason: "denied_path" });
  });
});

describe("host deny list (docs/planning/09 §6)", () => {
  it("builds the list from the machine's own environment", () => {
    expect(
      deniedPaths("win32", {
        windowsDir: "C:\\Windows",
        programFiles: "C:\\Program Files",
        programData: "C:\\ProgramData",
        userProfile: "C:\\Users\\a",
        runnerDataDir: "C:\\Users\\a\\AppData\\Local\\UniversalAgent",
      }),
    ).toEqual([
      "C:\\Windows",
      "C:\\Program Files",
      "C:\\ProgramData\\opencode",
      "C:\\Users\\a\\.ssh",
      "C:\\Users\\a\\.aws",
      "C:\\Users\\a\\AppData\\Local\\UniversalAgent",
    ]);
  });

  it("omits what the environment does not say, and drops what is not canonical", () => {
    expect(deniedPaths("win32", { userProfile: "C:\\Users\\a" })).toEqual([
      "C:\\Users\\a\\.ssh",
      "C:\\Users\\a\\.aws",
    ]);
    expect(deniedPaths("posix", {})).toEqual([]);
    // A relative or malformed variable is not a deny rule; it is noise, and
    // silently denying `''` would deny everything.
    expect(deniedPaths("win32", { windowsDir: "Windows", userProfile: "" })).toEqual([]);
  });
});
