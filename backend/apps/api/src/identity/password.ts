import { argon2id, hash, needsRehash, verify } from "argon2";

/** Argon2id is the variant with both side-channel and GPU resistance (docs/planning/11 §5). */
export interface Argon2Params {
  readonly memoryKib: number;
  readonly timeCost: number;
  readonly parallelism: number;
}

/**
 * The parameters are embedded in the produced hash, so re-tuning them does not
 * invalidate an existing credential — `passwordHashNeedsUpgrade` is what
 * migrates one on the next successful sign-in.
 */
export function hashPassword(password: string, params: Argon2Params): Promise<string> {
  return hash(password, {
    type: argon2id,
    memoryCost: params.memoryKib,
    timeCost: params.timeCost,
    parallelism: params.parallelism,
  });
}

/**
 * Never throws. A stored hash that cannot be parsed is a failed sign-in, not a
 * 500 — and the caller must not be able to tell those apart.
 */
export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

/** True when the stored hash is weaker than the current parameters, or unreadable. */
export function passwordHashNeedsUpgrade(passwordHash: string, params: Argon2Params): boolean {
  try {
    // needsRehash compares only these four; the variant is read from the digest.
    return needsRehash(passwordHash, {
      memoryCost: params.memoryKib,
      timeCost: params.timeCost,
      parallelism: params.parallelism,
    });
  } catch {
    return true;
  }
}
