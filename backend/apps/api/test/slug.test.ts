import { describe, expect, it } from "vitest";
import { slugCandidates, slugify } from "../src/common/slug.js";

describe("slugify", () => {
  it("normalises and lowercases", () => {
    expect(slugify("Universal Agent")).toBe("universal-agent");
  });

  it("drops non-alphanumeric and trims", () => {
    expect(slugify("  Hello, World!!!  ")).toBe("hello-world");
  });

  it("handles unicode by removing diacritics", () => {
    expect(slugify("Café")).toBe("cafe");
  });

  it("falls back to org for empty", () => {
    expect(slugify("!!!")).toBe("org");
  });

  it("truncates to 40 chars", () => {
    const long = "a".repeat(50);
    expect(slugify(long).length).toBe(40);
  });
});

describe("slugCandidates", () => {
  it("returns base first and randomised fallback", () => {
    const cands = slugCandidates("My Team");
    expect(cands[0]).toBe("my-team");
    expect(cands.length).toBeGreaterThan(0);
    expect(cands[1]).toMatch(/my-team-[0-9a-f]{6}$/);
  });
});
