import { describe, expect, it } from "vitest";
import { initialState, reduce, resolveConfig } from "../src/machine";
import type { RunConfig, RunEvent, RunState } from "../src/types";

type S = RunState<{ concept: string }, string, string, string>;
type E = RunEvent<string, string, string>;

const cfg = (over: Partial<RunConfig> = {}) => resolveConfig({ maxRevisions: 2, maxClarifications: 1, ...over });
const fold = (events: E[], config = cfg(), from: S = initialState("r1", { concept: "Chain Rule" })): S =>
  events.reduce((s, e) => reduce(s, e, config), from);

const drafted: E = { type: "drafted", draft: "d0" };
const rejected = (...o: string[]): E => ({ type: "reviewed", accepted: false, objections: o });
const revised = (d: string): E => ({ type: "revised", draft: d });
const asksHuman = (question?: string, ...o: string[]): E => ({
  type: "reviewed", accepted: false, objections: o, needsClarification: true,
  ...(question !== undefined ? { clarifyingQuestion: question } : {}),
});

describe("reviewer-requested clarification", () => {
  it("goes straight to asking, even with revision budget left, carrying the reviewer's question", () => {
    const s = fold([drafted, asksHuman("What did you mean by X?", "unclear what the student believes")]);
    expect(s).toMatchObject({
      phase: "asking", stopReason: "reviewer", suggestedQuestion: "What did you mean by X?",
      revisionsUsed: 0, objections: ["unclear what the student believes"],
    });
  });

  it("works without a suggested question", () => {
    expect(fold([drafted, asksHuman()])).toMatchObject({ phase: "asking", stopReason: "reviewer", suggestedQuestion: null });
  });

  it("works with no objections at all", () => {
    expect(fold([drafted, asksHuman("Why B?")])).toMatchObject({ phase: "asking", objections: [] });
  });

  it("is not treated as 'stuck' even if it repeats the previous objections", () => {
    const s = fold([drafted, rejected("a"), revised("d1"), asksHuman("Q?", "a")]);
    expect(s).toMatchObject({ phase: "asking", stopReason: "reviewer" });
  });

  it("question_posed clears the suggestion; the answer then reopens revising as usual", () => {
    const paused = fold([drafted, asksHuman("Why B?"), { type: "question_posed", question: "Why B?" }]);
    expect(paused).toMatchObject({ phase: "awaiting_human", suggestedQuestion: null, question: "Why B?" });
    const after = fold([{ type: "answered", answer: "Because ..." }], cfg(), paused);
    expect(after).toMatchObject({
      phase: "revising", stopReason: null, suggestedQuestion: null, revisionsUsed: 0, roundReviews: 0,
      clarifications: [{ question: "Why B?", answer: "Because ..." }],
    });
  });

  it("gives up (keeping the draft) if the reviewer asks but we've already used our questions", () => {
    const s = fold([drafted, asksHuman("Q?")], cfg({ maxClarifications: 0 }));
    expect(s).toMatchObject({ phase: "gave_up", stopReason: "reviewer", draft: "d0" });
  });

  it("a second reviewer request after one answered question gives up when maxClarifications is 1", () => {
    const paused = fold([drafted, asksHuman("Q1?"), { type: "question_posed", question: "Q1?" }]);
    const s = fold([{ type: "answered", answer: "A1" }, revised("d1"), asksHuman("Q2?")], cfg(), paused);
    expect(s).toMatchObject({ phase: "gave_up", stopReason: "reviewer" });
  });

  it("needsClarification: false behaves like a normal rejection", () => {
    const s = fold([drafted, { type: "reviewed", accepted: false, objections: ["a"], needsClarification: false }]);
    expect(s).toMatchObject({ phase: "revising", stopReason: null, suggestedQuestion: null });
  });

  it("an accepted review ignores needsClarification", () => {
    const s = fold([drafted, { type: "reviewed", accepted: true, objections: [], needsClarification: true }]);
    expect(s.phase).toBe("accepted");
  });

  it("normal rejections never set a suggestion", () => {
    expect(fold([drafted, rejected("a")]).suggestedQuestion).toBeNull();
  });

  it("state with a suggestion survives a JSON round trip", () => {
    const s = fold([drafted, asksHuman("Q?", "a")]);
    expect(JSON.parse(JSON.stringify(s))).toEqual(s);
  });
});
