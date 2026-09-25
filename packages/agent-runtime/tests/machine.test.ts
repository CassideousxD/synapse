import { describe, expect, it } from "vitest";
import { DEFAULT_CONFIG, initialState, InvalidTransitionError, reduce, resolveConfig, sameObjections } from "../src/machine";
import type { RunConfig, RunEvent, RunState } from "../src/types";

type S = RunState<{ concept: string }, string, string, string>;
type E = RunEvent<string, string, string>;

const cfg = (over: Partial<RunConfig> = {}) => resolveConfig({ maxRevisions: 2, maxClarifications: 1, ...over });
const start = (): S => initialState("r1", { concept: "Chain Rule" });
const fold = (events: E[], config = cfg(), from: S = start()): S =>
  events.reduce((s, e) => reduce(s, e, config), from);

const drafted: E = { type: "drafted", draft: "d0" };
const rejected = (...o: string[]): E => ({ type: "reviewed", accepted: false, objections: o });
const revised = (d: string): E => ({ type: "revised", draft: d });

describe("initialState", () => {
  it("starts in drafting with clean counters", () => {
    expect(start()).toMatchObject({
      phase: "drafting", draft: null, objections: [], revisionsUsed: 0, clarifications: [], question: null, error: null, trace: [],
    });
  });
});

describe("reduce: happy and revise paths", () => {
  it("drafted -> reviewing", () => {
    expect(fold([drafted])).toMatchObject({ phase: "reviewing", draft: "d0" });
  });

  it("accepted review finishes the run", () => {
    const s = fold([drafted, { type: "reviewed", accepted: true, objections: [] }]);
    expect(s.phase).toBe("accepted");
    expect(s.trace).toEqual(["drafted", "reviewed:accepted"]);
  });

  it("a rejection within budget goes to revising and keeps the objections", () => {
    const s = fold([drafted, rejected("wrong sign")]);
    expect(s).toMatchObject({ phase: "revising", objections: ["wrong sign"], roundReviews: 1 });
  });

  it("revised counts a revision and goes back to reviewing", () => {
    const s = fold([drafted, rejected("a"), revised("d1")]);
    expect(s).toMatchObject({ phase: "reviewing", draft: "d1", revisionsUsed: 1 });
  });
});

describe("reduce: stopping conditions", () => {
  it("out of revision budget -> asking (stopReason budget)", () => {
    const s = fold([drafted, rejected("a"), revised("d1"), rejected("b"), revised("d2"), rejected("c")]);
    expect(s).toMatchObject({ phase: "asking", stopReason: "budget", revisionsUsed: 2 });
  });

  it("maxRevisions 0 asks right after the first rejection", () => {
    const s = fold([drafted, rejected("a")], cfg({ maxRevisions: 0 }));
    expect(s).toMatchObject({ phase: "asking", stopReason: "budget" });
  });

  it("the same objections twice in a row -> asking early (stopReason stuck)", () => {
    const s = fold([drafted, rejected("Sign error"), revised("d1"), rejected("  sign ERROR ")]);
    expect(s).toMatchObject({ phase: "asking", stopReason: "stuck", revisionsUsed: 1 });
  });

  it("different objections are not stuck", () => {
    const s = fold([drafted, rejected("a"), revised("d1"), rejected("b")]);
    expect(s.phase).toBe("revising");
  });

  it("no clarifications left -> gave_up, keeping the best draft", () => {
    const s = fold([drafted, rejected("a")], cfg({ maxRevisions: 0, maxClarifications: 0 }));
    expect(s).toMatchObject({ phase: "gave_up", draft: "d0", stopReason: "budget" });
  });

  it("a custom isStuck is honoured", () => {
    const always = cfg({ isStuck: () => true });
    const s = fold([drafted, rejected("a"), revised("d1"), rejected("totally different")], always);
    expect(s).toMatchObject({ phase: "asking", stopReason: "stuck" });
  });
});

describe("reduce: human in the loop", () => {
  const paused = () =>
    fold([drafted, rejected("a"), revised("d1"), rejected("b"), revised("d2"), rejected("c"),
      { type: "question_posed", question: "What did you mean by X?" }]);

  it("question_posed pauses with the question stored", () => {
    expect(paused()).toMatchObject({ phase: "awaiting_human", question: "What did you mean by X?" });
  });

  it("answered records the Q&A, resets the round, and goes to revising", () => {
    const s = fold([{ type: "answered", answer: "I meant Y" }], cfg(), paused());
    expect(s).toMatchObject({
      phase: "revising", question: null, stopReason: null, revisionsUsed: 0, roundReviews: 0,
      clarifications: [{ question: "What did you mean by X?", answer: "I meant Y" }],
    });
    expect(s.objections).toEqual(["c"]); // still available to the reviser
  });

  it("after an answer, repeating the pre-answer objections is NOT 'stuck' (new round)", () => {
    const s = fold([{ type: "answered", answer: "Y" }, revised("d3"), rejected("c")], cfg(), paused());
    expect(s.phase).toBe("revising");
  });

  it("a second failed round with clarifications used up -> gave_up", () => {
    const s = fold(
      [{ type: "answered", answer: "Y" }, revised("d3"), rejected("x"), revised("d4"), rejected("y")],
      cfg(), paused(),
    );
    expect(s).toMatchObject({ phase: "gave_up", draft: "d4" });
  });
});

describe("reduce: failure and retry", () => {
  it("step_failed records where it failed; retried resumes there with counters intact", () => {
    const failed = fold([drafted, rejected("a"), { type: "step_failed", message: "network down" }]);
    expect(failed).toMatchObject({ phase: "failed", error: { message: "network down", during: "revising" } });
    const back = fold([{ type: "retried" }], cfg(), failed);
    expect(back).toMatchObject({ phase: "revising", error: null, objections: ["a"], roundReviews: 1 });
  });
});

describe("reduce: guards", () => {
  it("rejects events that don't fit the phase", () => {
    expect(() => reduce(start(), { type: "answered", answer: "x" }, cfg())).toThrow(InvalidTransitionError);
    expect(() => fold([drafted, drafted])).toThrow(InvalidTransitionError);
    expect(() => fold([{ type: "retried" }])).toThrow(InvalidTransitionError);
  });

  it("never mutates the input state", () => {
    const s0 = fold([drafted]);
    const snapshot = JSON.stringify(s0);
    reduce(s0, rejected("a"), cfg());
    expect(JSON.stringify(s0)).toBe(snapshot);
  });

  it("state survives a JSON round trip unchanged", () => {
    const s = fold([drafted, rejected("a"), revised("d1")]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});

describe("config", () => {
  it("has sane defaults", () => {
    expect(DEFAULT_CONFIG).toMatchObject({ maxRevisions: 2, maxClarifications: 1 });
  });
  it("rejects negative or fractional budgets", () => {
    expect(() => resolveConfig({ maxRevisions: -1 })).toThrow(/maxRevisions/);
    expect(() => resolveConfig({ maxClarifications: 1.5 })).toThrow(/maxClarifications/);
  });
  it("sameObjections ignores order, case, and whitespace", () => {
    expect(sameObjections(["A  b", "c"], ["C", "a b"])).toBe(true);
    expect(sameObjections(["a"], ["a", "b"])).toBe(false);
  });
});
