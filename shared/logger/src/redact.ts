/**
 * Redaction deny-list.
 *
 * This is a security control, not a formatting nicety (docs/planning/03 §5.12).
 * A log line leaves the process: to a file on the user's disk, to a collector, to
 * a support bundle a customer attaches to a ticket. A secret that reaches a log
 * line has left the trust boundary, so the default is to redact and the burden of
 * proof is on excluding something.
 */

export const REDACTED = "[REDACTED]";

/** Returned instead of recursing past `MAX_DEPTH`. */
export const MAX_DEPTH_MARKER = "[TRUNCATED:MAX_DEPTH]";
export const CIRCULAR_MARKER = "[CIRCULAR]";

const MAX_DEPTH = 8;

/**
 * Substrings that make a key secret, matched against the normalised key
 * (lower-cased, separators removed) so `api_key`, `apiKey` and `X-Api-Key` all
 * normalise to a match.
 *
 * Deliberately broad: a false positive costs a debug line, a false negative
 * costs a credential.
 */
const SECRET_SUBSTRINGS = [
  "password",
  "passwd",
  "passphrase",
  "secret",
  "apikey",
  "privatekey",
  "accesskey",
  "credential",
  "authorization",
  "cookie",
  "token",
  "bearer",
  "csrf",
  "xsrf",
  "signature",
  "sessionid",
  "connectionstring",
  "databaseurl",
  "dburl",
  "redisurl",
  "pwd",
  "dsn",
  "otp",
  "totp",
  "mfa",
] as const;

/**
 * Reviewed exceptions: keys that look secret but are not.
 *
 * Adding a name here is a security decision. `tokensIn`/`tokensOut` are budget
 * counters (docs/planning/08 §2.1); `authorizationDecision*` is the policy
 * decision record (docs/planning/10 §10), which is exactly what an audit
 * investigation needs to read.
 */
const SAFE_KEYS = new Set([
  "tokensin",
  "tokensout",
  "authorizationdecision",
  "authorizationdecisions",
]);

function normaliseKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True when a field's value must never be written, whatever it holds. */
export function isSecretKey(key: string): boolean {
  const normalised = normaliseKey(key);
  if (SAFE_KEYS.has(normalised)) {
    return false;
  }
  return SECRET_SUBSTRINGS.some((needle) => normalised.includes(needle));
}

/**
 * Secrets that appear inside a *value* rather than a key — a credential pasted
 * into a message, a connection string in a stack trace. The deny-list above
 * cannot see these, so they are matched by shape.
 */
const VALUE_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Private key material.
  [/-----BEGIN [^-]{0,40}PRIVATE KEY-----[\s\S]*?-----END [^-]{0,40}PRIVATE KEY-----/g, REDACTED],
  // JSON Web Tokens (header.payload.signature, base64url).
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{2,}\b/g, REDACTED],
  // Vendor-prefixed API keys and personal access tokens.
  [
    /\b(?:sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[A-Za-z0-9_-]{30,}|AKIA[0-9A-Z]{16}|npm_[A-Za-z0-9]{30,}|pypi-[A-Za-z0-9_-]{30,}|dckr_pat_[A-Za-z0-9_-]{20,})\b/g,
    REDACTED,
  ],
  // Credentials embedded in a URL's userinfo section.
  [/\b([a-z][a-z0-9+.-]*:\/\/[^/\s:@]+):[^@\s/]+@/gi, `$1:${REDACTED}@`],
  // An Authorization header value that lost its header name.
  [/\bBearer\s+[A-Za-z0-9._~+/-]{8,}=*/g, `Bearer ${REDACTED}`],
];

/** Applies every value pattern to a string. */
export function redactString(value: string): string {
  let result = value;
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep-copies a value into something safe to serialise: secret-named keys are
 * replaced, secret-shaped values are scrubbed, and structures that would make
 * `JSON.stringify` throw (cycles, `BigInt`, `Error`) are converted.
 *
 * Ancestor tracking (rather than a plain seen-set) is used for cycles so that the
 * same object appearing twice as siblings is duplicated, not reported circular.
 */
export function redactValue(value: unknown, depth = 0, ancestors = new WeakSet<object>()): unknown {
  switch (typeof value) {
    case "string":
      return redactString(value);
    case "number":
      return Number.isFinite(value) ? value : String(value);
    case "boolean":
    case "undefined":
      return value;
    case "bigint":
      // JSON.stringify throws on BigInt.
      return value.toString();
    case "symbol":
      return String(value);
    case "function":
      return "[Function]";
    default:
      break;
  }

  if (value === null || typeof value !== "object") {
    return value;
  }
  if (depth >= MAX_DEPTH) {
    return MAX_DEPTH_MARKER;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (value instanceof Error) {
    const converted: Record<string, unknown> = {
      name: value.name,
      message: redactString(value.message),
    };
    if (typeof value.stack === "string") {
      converted.stack = redactString(value.stack);
    }
    return converted;
  }
  if (value instanceof ArrayBuffer || ArrayBuffer.isView(value)) {
    return `[binary ${value.byteLength} bytes]`;
  }
  if (ancestors.has(value)) {
    return CIRCULAR_MARKER;
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((item) => redactValue(item, depth + 1, ancestors));
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      result[key] = isSecretKey(key) ? REDACTED : redactValue(item, depth + 1, ancestors);
    }
    return result;
  } finally {
    ancestors.delete(value);
  }
}
