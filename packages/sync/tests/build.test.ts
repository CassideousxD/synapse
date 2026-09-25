import { describe, it, expect } from "vitest";
import { computeMastery, buildAnalysisPayload } from "../src";
import type { Attempt } from "@synapse/contracts";

const attempt = (isCorrect: boolean, submittedAt: string): Attempt => ({
  id: `a-${submittedAt}`,
  studentId: "s1",
  testId: "t1",
  conceptId: "c1",
  questionId: "q1",
  selectedOption: isCorrect ? "correct" : "wrong",
  correctOption: "correct",
  isCorrect,
  submittedAt,
});

describe("computeMastery", () => {
  it("no attempts -> new_gap, mastery 0", () => {
    expect(computeMastery([])).toEqual({ mastery: 0, trend: "new_gap" });
  });

  it("single wrong attempt -> new_gap", () => {
    expect(computeMastery([attempt(false, "2026-01-01T00:00:00Z")])).toEqual({
      mastery: 0,
      trend: "new_gap",
    });
  });

  it("single correct attempt -> improving", () => {
    expect(computeMastery([attempt(true, "2026-01-01T00:00:00Z")])).toEqual({
      mastery: 1,
      trend: "improving",
    });
  });

  it("accuracy rising across attempts -> improving", () => {
    const attempts = [
      attempt(false, "2026-01-01T00:00:00Z"),
      attempt(false, "2026-01-02T00:00:00Z"),
      attempt(true, "2026-01-03T00:00:00Z"),
      attempt(true, "2026-01-04T00:00:00Z"),
    ];
    expect(computeMastery(attempts).trend).toBe("improving");
  });

  it("consistently weak, no improvement -> still_weak", () => {
    const attempts = [
      attempt(false, "2026-01-01T00:00:00Z"),
      attempt(true, "2026-01-02T00:00:00Z"),
      attempt(false, "2026-01-03T00:00:00Z"),
      attempt(false, "2026-01-04T00:00:00Z"),
    ];
    const result = computeMastery(attempts);
    expect(result.mastery).toBeLessThan(0.5);
    expect(result.trend).toBe("still_weak");
  });

  it("is order-independent on input array (sorts by submittedAt)", () => {
    const inOrder = [attempt(false, "2026-01-01T00:00:00Z"), attempt(true, "2026-01-02T00:00:00Z")];
    const reversed = [inOrder[1]!, inOrder[0]!];
    expect(computeMastery(inOrder)).toEqual(computeMastery(reversed));
  });
});

describe("buildAnalysisPayload", () => {
  it("assembles the full payload with an injected clock", () => {
    const payload = buildAnalysisPayload("s1", "c1", [attempt(true, "2026-01-01T00:00:00Z")], () => "FIXED_TIME");
    expect(payload).toEqual({
      studentId: "s1",
      conceptId: "c1",
      mastery: 1,
      trend: "improving",
      computedAt: "FIXED_TIME",
    });
  });
});
