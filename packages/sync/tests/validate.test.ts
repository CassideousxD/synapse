import { describe, it, expect } from "vitest";
import { assertValidPayload, InvalidPayloadError } from "../src";

const valid = {
  studentId: "s1",
  conceptId: "c1",
  mastery: 0.5,
  trend: "still_weak",
  computedAt: "2026-01-01T00:00:00Z",
};

describe("assertValidPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(assertValidPayload(valid)).toEqual(valid);
  });

  it("rejects an extra field — this IS the privacy boundary", () => {
    const leaky = { ...valid, noteText: "should never leave the device" };
    expect(() => assertValidPayload(leaky)).toThrow(InvalidPayloadError);
  });

  it("rejects a missing required field", () => {
    const { computedAt, ...rest } = valid;
    expect(() => assertValidPayload(rest)).toThrow(InvalidPayloadError);
  });

  it("rejects an out-of-range mastery", () => {
    expect(() => assertValidPayload({ ...valid, mastery: 1.5 })).toThrow(InvalidPayloadError);
  });

  it("rejects an invalid trend value", () => {
    expect(() => assertValidPayload({ ...valid, trend: "mastered" })).toThrow(InvalidPayloadError);
  });
});
