import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Session and refresh credentials are opaque 256-bit random strings, not signed
 * tokens: revocation has to be immediate (docs/planning/11 §5), and a signed
 * token cannot be revoked without a store — at which point the signature buys
 * nothing and costs a key to rotate.
 *
 * Only a digest of a credential is stored, so a leaked database yields no usable
 * session. A plain SHA-256 is the right tool here and a slow KDF is not: the
 * input is 256 random bits, so there is nothing to guess.
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

export function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * A keyed digest for values that *are* guessable — an email address, an IP, a
 * user-agent string. Keyed so the stored value cannot be reversed by hashing a
 * candidate list, which is what makes `login_attempts` safe to keep.
 */
export function digest(secret: string, purpose: string, value: string): string {
  return createHmac("sha256", secret).update(`${purpose}:${value}`).digest("hex");
}

/**
 * The CSRF double-submit token (docs/planning/07 §1 "Auth").
 *
 * Derived from the session id instead of stored: a page that cannot read the
 * HttpOnly session cookie cannot compute this value, so injecting a matching
 * cookie and header pair — the usual weakness of a plain double submit — is not
 * enough to forge a request.
 */
export function csrfToken(secret: string, sessionId: string): string {
  return createHmac("sha256", secret).update(`csrf:${sessionId}`).digest("base64url");
}

/** Constant-time, and length-safe: a length mismatch is a mismatch, not a crash. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}
