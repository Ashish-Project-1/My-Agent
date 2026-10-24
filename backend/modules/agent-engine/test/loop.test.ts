import { describe, expect, it } from "vitest";
import { isRepeatedAction } from "../src/loop.js";

describe("isRepeatedAction", () => {
  it("allows the first two occurrences of an action", () => {
    expect(isRepeatedAction([], "a")).toBe(false);
    expect(isRepeatedAction(["a"], "a")).toBe(false);
  });

  it("detects the third identical action", () => {
    expect(isRepeatedAction(["a", "a"], "a")).toBe(true);
    expect(isRepeatedAction(["a", "b", "a"], "a")).toBe(true);
  });

  it("does not trip on different actions", () => {
    expect(isRepeatedAction(["a", "a"], "b")).toBe(false);
  });
});
