import { describe, expect, it } from "vitest";
import { csrfToken, digest, newToken, safeEqual, tokenHash } from "../src/identity/tokens.js";

const SECRET = "s".repeat(32);

describe("tokens", () => {
  it("produces stable digests", () => {
    const h1 = tokenHash("abc");
    const h2 = tokenHash("abc");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(64);
  });

  it("digest is keyed and purpose separated", () => {
    const a = digest(SECRET, "ip", "1.2.3.4");
    const b = digest(SECRET, "email", "1.2.3.4");
    expect(a).not.toBe(b);
  });

  it("csrf differs per session", () => {
    const t1 = csrfToken(SECRET, "s1");
    const t2 = csrfToken(SECRET, "s2");
    expect(t1).not.toBe(t2);
  });

  it("safeEqual is length safe", () => {
    expect(safeEqual("abc", "ab")).toBe(false);
    expect(safeEqual("abc", "abc")).toBe(true);
  });

  it("newToken returns base64url string", () => {
    const t = newToken();
    expect(typeof t).toBe("string");
    expect(t.length).toBeGreaterThan(20);
  });
});
