import { PairingCode } from "@ua/contracts";
import { describe, expect, it } from "vitest";
import { generatePairingCode, normalisePairingCode } from "../src/devices/pairing-code.js";

describe("pairing codes", () => {
  it("generates codes the contract accepts, in a shape a human can read out", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generatePairingCode();
      expect(() => PairingCode.parse(code)).not.toThrow();
      expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
    }
  });

  it("omits the letters a person misreads as digits", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) {
      for (const symbol of generatePairingCode().replace("-", "")) {
        seen.add(symbol);
      }
    }
    for (const ambiguous of "ILOU") {
      expect(seen.has(ambiguous)).toBe(false);
    }
  });

  it("reduces what a person types to what was issued", () => {
    const code = generatePairingCode();
    const typed = ` ${code.toLowerCase().replace("-", " ")} `;
    expect(normalisePairingCode(typed)).toBe(normalisePairingCode(code));
  });
});
