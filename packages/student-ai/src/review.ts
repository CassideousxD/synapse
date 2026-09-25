import type { ReviewOutcome } from "@synapse/agent-runtime";
import type { ReviewResult } from "@synapse/contracts";
import reviewSchema from "@synapse/contracts/schemas/review-result.schema.json";
import { createValidator, pickSchema, refine } from "./validate";

/** What the reviewer model may produce. Ids, noteVersion and timestamps are not its business. */
export type ReviewDraft = Pick<ReviewResult, "verdict" | "objections" | "clarifyingQuestion">;

export const reviewDraftValidator = refine(
  createValidator<ReviewDraft>("ReviewResult", pickSchema(reviewSchema, ["verdict", "objections", "clarifyingQuestion"])),
  (r) => {
    const problems: string[] = [];
    if (r.verdict === "revise" && r.objections.length === 0) {
      problems.push('verdict is "revise" but objections is empty; list what to fix');
    }
    if (r.objections.some((o) => o.message.trim() === "")) problems.push("every objection needs a non-blank message");
    // A missing or blank clarifyingQuestion is fine. Models often fill the key with "" when it does not apply
    // (the first live run repaired almost every review because of it), and for needs_clarification with no
    // question the ask step writes one.
    return problems;
  },
);

/** Map the reviewer's verdict onto what the runtime understands. */
export function toReviewOutcome(r: ReviewDraft): ReviewOutcome {
  if (r.verdict === "pass") return { accepted: true, objections: [] };
  const objections = r.objections.map((o) => `[${o.kind}] ${o.message.trim()}`);
  if (r.verdict === "revise") return { accepted: false, objections };
  const question = (r.clarifyingQuestion ?? "").trim();
  return {
    accepted: false,
    objections,
    needsClarification: true,
    ...(question !== "" ? { clarifyingQuestion: question } : {}),
  };
}
