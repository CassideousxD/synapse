import { describe, expect, it } from "vitest";
import { createMemoryCheckpointStore } from "../src/checkpoints";
import { initialState, InvalidTransitionError } from "../src/machine";
import { createRunner, RunAlreadyExistsError, RunBusyError, RunNotFoundError } from "../src/runner";
import type { ReviewOutcome, RunConfig, RunState, Steps } from "../src/types";

type I = { concept: string };
type S = RunState<I, string, string, string>;

const ok: ReviewOutcome = { accepted: true, objections: [] };
const no = (...o: string[]): ReviewOutcome => ({ accepted: false, objections: o });

/** Fake steps: reviews come from a script (last one repeats). Every call is logged. */
function scripted(reviews: ReviewOutcome[], opts: { failOnce?: "draft" | "review" | "revise" | "ask" } = {}) {
  const calls: string[] = [];
  const seen: { revise: { objections: string[]; clarifications: unknown[] }[]; ask: { stopReason: string }[] } = {
    revise: [], ask: [],
  };
  let n = 0;
  let failed = false;
  const maybeFail = (step: string) => {
    if (opts.failOnce === step && !failed) {
      failed = true;
      throw new Error(`${step} blew up`);
    }
  };
  const steps: Steps<I, string, string, string> = {
    async draft({ input }) { calls.push("draft"); maybeFail("draft"); return `draft of ${input.concept}`; },
    async review() {
      calls.push("review"); maybeFail("review");
      const r = reviews[Math.min(n, reviews.length - 1)]!; n++;
      return r;
    },
    async revise({ draft, objections, clarifications }) {
      calls.push("revise"); maybeFail("revise");
      seen.revise.push({ objections, clarifications });
      return `${draft}+`;
    },
    async ask({ stopReason }) { calls.push("ask"); maybeFail("ask"); seen.ask.push({ stopReason }); return "What did you mean?"; },
  };
  return { steps, calls, seen };
}

function setup(reviews: ReviewOutcome[], config: Partial<RunConfig> = {}, opts: Parameters<typeof scripted>[1] = {}) {
  const fake = scripted(reviews, opts);
  const checkpoints = createMemoryCheckpointStore<I, string, string, string>();
  const saved: S[] = [];
  const runner = createRunner({ steps: fake.steps, checkpoints, config, onCheckpoint: (s) => saved.push(s) });
  return { ...fake, checkpoints, runner, saved };
}

const input: I = { concept: "Chain Rule" };

describe("runner: normal flow", () => {
  it("accepts on the first review", async () => {
    const t = setup([ok]);
    const s = await t.runner.start("r1", input);
    expect(s.phase).toBe("accepted");
    expect(s.draft).toBe("draft of Chain Rule");
    expect(t.calls).toEqual(["draft", "review"]);
  });

  it("revises once, then accepts, passing objections to the reviser", async () => {
    const t = setup([no("sign error"), ok]);
    const s = await t.runner.start("r1", input);
    expect(s).toMatchObject({ phase: "accepted", draft: "draft of Chain Rule+" });
    expect(t.calls).toEqual(["draft", "review", "revise", "review"]);
    expect(t.seen.revise[0]?.objections).toEqual(["sign error"]);
  });

  it("checkpoints after every transition (plus the initial state)", async () => {
    const t = setup([no("a"), ok]);
    await t.runner.start("r1", input);
    expect(t.saved.map((s) => s.phase)).toEqual(["drafting", "reviewing", "revising", "reviewing", "accepted"]);
    expect((await t.checkpoints.load("r1"))?.phase).toBe("accepted");
  });
});

describe("runner: bounded revisions and human-in-the-loop", () => {
  it("stops revising at the budget and pauses with a question", async () => {
    const t = setup([no("a"), no("b"), no("c")], { maxRevisions: 2 });
    const s = await t.runner.start("r1", input);
    expect(s).toMatchObject({ phase: "awaiting_human", question: "What did you mean?", stopReason: "budget" });
    expect(t.calls.filter((c) => c === "revise")).toHaveLength(2);
    expect(t.seen.ask).toEqual([{ stopReason: "budget" }]);
  });

  it("pauses early when the reviewer repeats itself", async () => {
    const t = setup([no("same problem"), no("same problem")], { maxRevisions: 5 });
    const s = await t.runner.start("r1", input);
    expect(s).toMatchObject({ phase: "awaiting_human", stopReason: "stuck" });
    expect(t.calls.filter((c) => c === "revise")).toHaveLength(1);
  });

  it("resume() on a paused run does nothing (no step calls)", async () => {
    const t = setup([no("a")], { maxRevisions: 0 });
    await t.runner.start("r1", input);
    const before = t.calls.length;
    const s = await t.runner.resume("r1");
    expect(s.phase).toBe("awaiting_human");
    expect(t.calls.length).toBe(before);
  });

  it("answer() feeds the human's reply to the reviser and can finish the run", async () => {
    const t = setup([no("a"), no("b"), no("c"), ok], { maxRevisions: 2 });
    await t.runner.start("r1", input);
    const s = await t.runner.answer("r1", "I meant Y");
    expect(s.phase).toBe("accepted");
    const last = t.seen.revise[t.seen.revise.length - 1];
    expect(last?.clarifications).toEqual([{ question: "What did you mean?", answer: "I meant Y" }]);
    expect(s.clarifications).toHaveLength(1);
  });

  it("gives up (keeping the best draft) if it still fails after the human answered", async () => {
    const t = setup([no("x")].concat(Array.from({ length: 10 }, (_, i) => no(`obj ${i}`))), { maxRevisions: 1, maxClarifications: 1 });
    await t.runner.start("r1", input);
    const s = await t.runner.answer("r1", "Y");
    expect(s.phase).toBe("gave_up");
    expect(s.draft).toMatch(/^draft of Chain Rule\+/);
    expect(t.calls.filter((c) => c === "ask")).toHaveLength(1);
  });
});

describe("runner: failures, retry, resume", () => {
  it("a throwing step marks the run failed; retry re-runs just that step", async () => {
    const t = setup([ok], {}, { failOnce: "review" });
    const failed = await t.runner.start("r1", input);
    expect(failed).toMatchObject({ phase: "failed", error: { message: "review blew up", during: "reviewing" } });
    const s = await t.runner.retry("r1");
    expect(s.phase).toBe("accepted");
    expect(t.calls).toEqual(["draft", "review", "review"]); // draft not repeated
  });

  it("a reviewer that rejects without objections fails the run clearly", async () => {
    const t = setup([{ accepted: false, objections: [] }]);
    const s = await t.runner.start("r1", input);
    expect(s).toMatchObject({ phase: "failed", error: { during: "reviewing" } });
    expect(s.error?.message).toMatch(/without giving any objections/);
  });

  it("resume() continues an interrupted run from its checkpoint without redoing finished steps", async () => {
    const t = setup([ok]);
    const mid: S = { ...initialState<I, string, string, string>("r1", input), phase: "reviewing", draft: "saved draft", trace: ["drafted"] };
    await t.checkpoints.save(mid);
    const s = await t.runner.resume("r1");
    expect(s).toMatchObject({ phase: "accepted", draft: "saved draft" });
    expect(t.calls).toEqual(["review"]); // no draft call
  });

  it("survives a 'tab close': paused state -> JSON -> brand-new runner -> answer -> done", async () => {
    const first = setup([no("a"), no("b"), no("c")], { maxRevisions: 2 });
    await first.runner.start("r1", input);

    const json = JSON.stringify(await first.checkpoints.list()); // what would sit in IndexedDB
    const second = setup([ok], { maxRevisions: 2 });
    for (const state of JSON.parse(json) as S[]) await second.checkpoints.save(state);

    const s = await second.runner.answer("r1", "I meant Y");
    expect(s.phase).toBe("accepted");
    expect(second.calls).toEqual(["revise", "review"]);
    expect(second.seen.revise[0]?.clarifications).toHaveLength(1);
  });
});

describe("runner: guards", () => {
  it("unknown run ids throw RunNotFoundError", async () => {
    const t = setup([ok]);
    await expect(t.runner.resume("nope")).rejects.toBeInstanceOf(RunNotFoundError);
    await expect(t.runner.answer("nope", "x")).rejects.toBeInstanceOf(RunNotFoundError);
  });

  it("start() twice with the same id throws RunAlreadyExistsError", async () => {
    const t = setup([ok]);
    await t.runner.start("r1", input);
    await expect(t.runner.start("r1", input)).rejects.toBeInstanceOf(RunAlreadyExistsError);
  });

  it("answer() on a run that isn't paused throws and leaves the stored state alone", async () => {
    const t = setup([ok]);
    await t.runner.start("r1", input);
    await expect(t.runner.answer("r1", "x")).rejects.toBeInstanceOf(InvalidTransitionError);
    expect((await t.checkpoints.load("r1"))?.phase).toBe("accepted");
  });

  it("a second call on a run that's mid-execution is rejected, not double-run", async () => {
    const t = setup([ok]);
    const p = t.runner.start("r1", input);
    await expect(t.runner.resume("r1")).rejects.toBeInstanceOf(RunBusyError);
    await p;
    expect(t.calls).toEqual(["draft", "review"]);
  });

  it("a throwing onCheckpoint observer cannot break the run", async () => {
    const fake = scripted([ok]);
    const runner = createRunner({
      steps: fake.steps,
      checkpoints: createMemoryCheckpointStore<I, string, string, string>(),
      onCheckpoint: () => { throw new Error("UI bug"); },
    });
    expect((await runner.start("r1", input)).phase).toBe("accepted");
  });

  it("rejects an invalid config up front", () => {
    expect(() => setup([ok], { maxRevisions: -1 })).toThrow(/maxRevisions/);
  });
});
