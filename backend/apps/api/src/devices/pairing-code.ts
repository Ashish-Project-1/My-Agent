import { randomBytes } from "node:crypto";
import type { PairingCode } from "@ua/contracts";

/**
 * Device-authorisation codes (FR-AUTH-07, docs/planning/12 §5.3).
 *
 * Crockford base32 without I, L, O or U: the code gets read aloud, typed by
 * hand and occasionally written down, which a hex string survives badly.
 */
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** 10 minutes, then the code is inert whether or not it was used (06 §2.2). */
export const PAIRING_CODE_TTL_MS = 10 * 60 * 1000;

/** 8 symbols = 40 bits. 256 % 32 === 0, so the modulo is exactly uniform. */
const CODE_SYMBOLS = 8;

export function generatePairingCode(): PairingCode {
  const symbols = [...randomBytes(CODE_SYMBOLS)].map((byte) => ALPHABET[byte % 32]).join("");
  return `${symbols.slice(0, 4)}-${symbols.slice(4)}`;
}

/**
 * What a presented code is reduced to before hashing: whitespace, dashes and
 * case are the user's business, not the credential's.
 *
 * The hash itself is keyed with the server secret (`digest`), because 40 bits
 * is small enough that a leaked table of plain SHA-256 digests could be
 * brute-forced on a GPU.
 */
export function normalisePairingCode(code: string): string {
  return code.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
}
