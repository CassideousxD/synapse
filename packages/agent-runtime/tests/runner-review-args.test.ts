import { describe, expect, it } from "vitest";
import { createMemoryCheckpointStore } from "../src/checkpoints";
import { createRunner } from "../src/runner";
import type { Clarification, ReviewOutcome, Steps } from "../src/types";

type I = { concept: string };

describe("runner: review() receives the clarifications gathered so far", () => {
  it("empty at first, then contains the student's answer after answer()", async () => {
    const seen: Clarification<string, string>[][] = [];
    const reviews: ReviewOutcome[] = [
      { accepted: false, objections: [], needsClarification: true, clarifyingQuestion: "Why B?" },
      { accepted: true, objections: [] },
    ];
    let n = 0;
    const steps: Steps<I, string, string, string> = {
      async draft() { return "d0"; },
      async review({ clarifications }) { seen.push(clarifications); return reviews[n++]!; },
      async revise({ draft }) { return `${draft}+`; },
      async ask({ suggestedQuestion }) { return suggestedQuestion ?? "?"; },
    };
    const runner = createRunner({ steps, checkpoints: createMemoryCheckpointStore<I, string, string, string>() });
    await runner.start("r1", { concept: "x" });
    const done = await runner.answer("r1", "Because of Y");
    expect(done.phase).toBe("accepted");
    expect(seen).toEqual([[], [{ question: "Why B?", answer: "Because of Y" }]]);
  });
});
