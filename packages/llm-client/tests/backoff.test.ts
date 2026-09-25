import { describe, expect, it } from "vitest";
import { backoffMs } from "../src/providers/nim";

describe("backoffMs", () => {
  it("grows exponentially with up to 25% jitter", () => {
    for (let i = 0; i < 4; i++) {
      const base = 1000 * 2 ** i;
      for (let k = 0; k < 50; k++) {
        const d = backoffMs(i);
        expect(d).toBeGreaterThanOrEqual(base);
        expect(d).toBeLessThanOrEqual(base * 1.25);
      }
    }
  });

  it("is capped", () => {
    expect(backoffMs(20)).toBeLessThanOrEqual(10_000);
  });
});
