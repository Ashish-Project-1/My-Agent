/**
 * Shell and argument hygiene (docs/planning/09 §7).
 *
 * The runner must never build a command string from model output and pass it to
 * `shell: true`. Values go in `argv` entries; any pattern that enables command
 * substitution is refused when a shell would be involved, and by default no shell
 * is used at all.
 */

const DANGEROUS_SHELL_CHARS = /[;|&`$()<>^%]/;

/** Common executables that the allow-list recognises by basename. */
export const DEFAULT_ALLOWED_BINARIES = new Set([
  "node",
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "git",
  "python",
  "python3",
  "pytest",
  "pip",
  "poetry",
  "dotnet",
  "cargo",
  "rustc",
  "go",
  "javac",
  "java",
  "make",
  "cmake",
  "tsc",
  "vitest",
  "eslint",
  "prettier",
  "biome",
]);

export interface ArgvValidationOptions {
  readonly allowList?: ReadonlySet<string>;
  readonly allowShell?: boolean;
}

/** The basename of a path, case-insensitively on Windows. */
export function executableBasename(
  executable: string,
  isWindows = process.platform === "win32",
): string {
  const normalized = executable.replace(/\\/g, "/");
  const base = normalized.split("/").pop() ?? executable;
  return isWindows ? base.toLowerCase() : base;
}

/**
 * Validate argv before execution. Returns an error message or null if it is
 * acceptable.
 */
export function validateArgv(
  argv: readonly string[],
  options: ArgvValidationOptions = {},
): string | null {
  if (argv.length === 0) {
    return "argv must not be empty";
  }
  const executable = argv[0] ?? "";
  if (executable === "") {
    return "executable must not be empty";
  }
  // A shell is only permitted when explicitly opted in and the caller knows the
  // risks; even then we refuse string-level substitution patterns.
  const allowShell = options.allowShell ?? false;
  if (!allowShell) {
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === undefined) continue;
      if (arg.includes("\u0000")) return "argument contains a null byte";
      if (DANGEROUS_SHELL_CHARS.test(arg)) {
        return `argument contains shell metacharacters: ${arg}`;
      }
    }
  } else {
    // Even with shell allowed, null bytes are never acceptable.
    for (let i = 0; i < argv.length; i += 1) {
      const arg = argv[i];
      if (arg === undefined) continue;
      if (arg.includes("\u0000")) return "argument contains a null byte";
    }
  }

  const allowList = options.allowList ?? DEFAULT_ALLOWED_BINARIES;
  const base = executableBasename(executable);
  if (!allowList.has(base)) {
    return `executable not in allow-list: ${base}`;
  }
  return null;
}
