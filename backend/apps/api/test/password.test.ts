import { describe, expect, it } from "vitest";
import {
  hashPassword,
  passwordHashNeedsUpgrade,
  verifyPassword,
} from "../src/identity/password.js";

const WEAK = { memoryKib: 65536, timeCost: 2, parallelism: 1 };
const STRONG = { memoryKib: 32768, timeCost: 3, parallelism: 1 };

describe("password", () => {
  it("verifies correct password", async () => {
    const h = await hashPassword("password123456", WEAK);
    expect(await verifyPassword(h, "password123456")).toBe(true);
  });

  it("rejects wrong password", async () => {
    const h = await hashPassword("password123456", WEAK);
    expect(await verifyPassword(h, "wrongwrongwrong")).toBe(false);
  });

  it("returns false for unparsable hash", async () => {
    expect(await verifyPassword("not-a-hash", "anything")).toBe(false);
  });

  it("detects upgrade when weaker", async () => {
    const h = await hashPassword("password123456", WEAK);
    expect(passwordHashNeedsUpgrade(h, STRONG)).toBe(true);
  });

  it("treats unparsable as needing upgrade", () => {
    expect(passwordHashNeedsUpgrade("bad", WEAK)).toBe(true);
  });
});
