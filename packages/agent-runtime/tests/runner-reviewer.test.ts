import { describe, expect, it } from "vitest";
import { createMemoryCheckpointStore } from "../src/checkpoints";
import { createRunner } from "../src/runner";
import type { ReviewOutcome, RunConfig, Steps } from "../src/types";

type I = { concept: string };

const ok: ReviewOutcome = { accepted: true, objections: [] };

function setup(reviews: ReviewOutcome[], config: Partial<RunConfig> = {}) {
  const calls: string[] = [];
  const revised: { objections: string[]; clarifications: unknown[] }[] = [];
  const asked: { stopReason: string; suggestedQuestion: string | null }[] = [];
  let n = 0;
  const steps: Steps<I, string, string, string> = {
    async draft() { calls.push("draft"); return "d0"; },
    async review() { calls.push("review"); const r = reviews[Math.min(n, reviews.length - 1)]!; n++; return r; },
    async revise({ draft, objections, clarifications }) { calls.push("revise"); revised.push({ objections, clarifications }); return `${draft}+`; },
    async ask({ stopReason, suggestedQuestion }) { calls.push("ask"); asked.push({ stopReason, suggestedQuestion }); return suggestedQuestion ?? "generated question?"; },
  };
  const runner = createRunner({ steps, checkpoints: createMemoryCheckpointStore<I, string, string, string>(), config });
  return { runner, calls, revised, asked };
}

const input: I = { concept: "Chain Rule" };

describe("runner: reviewer-requested clarification", () => {
  it("pauses right away, without revising, and hands the reviewer's question to ask()", async () => {
    const t = setup([{ accepted: false, objections: ["unclear"], needsClarification: true, clarifyingQuestion: "Why did you pick B?" }]);
    const s = await t.runner.start("r1", input);
    expect(s).toMatchObject({ phase: "awaiting_human", question: "Why did you pick B?", stopReason: "reviewer" });
    expect(t.calls).toEqual(["draft", "review", "ask"]);
    expect(t.asked).toEqual([{ stopReason: "reviewer", suggestedQuestion: "Why did you pick B?" }]);
  });

  it("is allowed to reject with no objections when it asks for clarification", async () => {
    const t = setup([{ accepted: false, objections: [], needsClarification: true }, ok]);
    const paused = await t.runner.start("r1", input);
    expect(paused.phase).toBe("awaiting_human");
    expect(t.asked[0]?.suggestedQuestion).toBeNull(); // ask() had to write its own question
    const done = await t.runner.answer("r1", "I thought X");
    expect(done.phase).toBe("accepted");
    expect(t.revised).toEqual([{ objections: [], clarifications: [{ question: "generated question?", answer: "I thought X" }] }]);
  });

  it("a plain rejection with no objections is still a failure", async () => {
    const t = setup([{ accepted: false, objections: [] }]);
    const s = await t.runner.start("r1", input);
    expect(s).toMatchObject({ phase: "failed", error: { during: "reviewing" } });
    expect(s.error?.message).toMatch(/without giving any objections/);
  });

  it("stuck and budget stops give ask() no suggestion", async () => {
    const t = setup([{ accepted: false, objections: ["same"] }, { accepted: false, objections: ["same"] }], { maxRevisions: 5 });
    await t.runner.start("r1", input);
    expect(t.asked).toEqual([{ stopReason: "stuck", suggestedQuestion: null }]);
  });

  it("gives up if the reviewer keeps asking after the student already answered once", async () => {
    const t = setup([
      { accepted: false, objections: [], needsClarification: true, clarifyingQuestion: "Q1?" },
      { accepted: false, objections: [], needsClarification: true, clarifyingQuestion: "Q2?" },
    ]);
    await t.runner.start("r1", input);
    const s = await t.runner.answer("r1", "A1");
    expect(s).toMatchObject({ phase: "gave_up", stopReason: "reviewer", draft: "d0+" });
    expect(t.calls.filter((c) => c === "ask")).toHaveLength(1);
  });
});
