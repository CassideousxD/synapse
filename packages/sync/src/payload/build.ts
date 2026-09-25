import type { Attempt } from "@synapse/contracts";
import type { AnalysisPayload } from "@synapse/contracts";

export interface MasteryCalc {
  mastery: number;
  trend: AnalysisPayload["trend"];
}

/**
 * Deterministic mastery/trend calc from a student's own Attempt history
 * for ONE concept. No attempts yet -> "new_gap". Otherwise mastery is
 * accuracy over all attempts; trend compares the first half of attempts
 * to the second half (chronologically) to see if accuracy is rising.
 *
 * ASSUMPTION worth revisiting: the schema only has 3 trend values, so a
 * student who is already doing well and staying flat gets "improving"
 * rather than something like "mastered" — there's no slot for that yet.
 */
export function computeMastery(attempts: Attempt[]): MasteryCalc {
  if (attempts.length === 0) {
    return { mastery: 0, trend: "new_gap" };
  }

  const sorted = [...attempts].sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));
  const correctness = sorted.map((a) => (a.isCorrect ? 1 : 0));
  const avg = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const mastery = Math.round(avg(correctness) * 100) / 100;

  if (sorted.length === 1) {
    return { mastery, trend: mastery >= 0.5 ? "improving" : "new_gap" };
  }

  const mid = Math.floor(sorted.length / 2);
  const delta = avg(correctness.slice(mid)) - avg(correctness.slice(0, mid));

  const trend: AnalysisPayload["trend"] =
    delta > 0.15 ? "improving" : mastery < 0.5 ? "still_weak" : "improving";

  return { mastery, trend };
}

export function buildAnalysisPayload(
  studentId: string,
  conceptId: string,
  attempts: Attempt[],
  now: () => string = () => new Date().toISOString(),
): AnalysisPayload {
  const { mastery, trend } = computeMastery(attempts);
  return { studentId, conceptId, mastery, trend, computedAt: now() };
}
