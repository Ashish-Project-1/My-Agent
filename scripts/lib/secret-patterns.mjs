/**
 * Secret shapes used by both `scan-secrets.mjs` (what must not be committed) and
 * `check-env-example.mjs` (what must not be filled in).
 *
 * Deliberately separate from the runtime redaction list in `@ua/logger`: that one
 * protects log output and is written in TypeScript behind a build, while these
 * run in a git hook that must work with nothing installed. Keep the two in sync
 * by hand when either changes.
 */

/** Non-global, so `.test()` cannot be tripped by `lastIndex` state. */
export const SECRET_PATTERNS = [
  {
    rule: "private-key",
    pattern: /-----BEGIN [^-]{0,40}PRIVATE KEY-----/,
  },
  {
    rule: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{2,}\b/,
  },
  {
    rule: "api-key-prefix",
    pattern:
      /\b(?:sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|npm_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_-]{30,}|dckr_pat_[A-Za-z0-9_-]{20,})\b/,
  },
  {
    rule: "credentialed-url",
    pattern: /\b[a-z][a-z0-9+.-]*:\/\/[^/\s:@]+:[^@\s/]+@/i,
  },
  {
    rule: "assigned-secret",
    pattern:
      /\b(?:password|passwd|secret|api_?key|access_?token|private_?key|client_?secret)\s*[:=]\s*["'][^"'\s]{8,}["']/i,
  },
];

/** Escapes the marker a human uses to accept a line that is only shaped like a secret. */
export const ALLOW_MARKER = "scan-secrets:allow";
export const ALLOW_FILE_MARKER = "scan-secrets:allow-file";

/** Which rules a single line trips. */
export function findSecrets(line) {
  if (line.includes(ALLOW_MARKER)) {
    return [];
  }
  return SECRET_PATTERNS.filter(({ pattern }) => pattern.test(line)).map(({ rule }) => rule);
}
