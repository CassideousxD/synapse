import { describe, expect, it } from "vitest";
import { createNoteSteps } from "../src/note-steps";
import type { NoteRunInput } from "../src/note-types";
import { routedLlm } from "./routed-llm";

const input: NoteRunInput = {
  studentId: "s1", cycleId: "t1",
  concept: { id: "c1", name: "Product Rule", summary: "How to differentiate a product." },
  linkable: [{ id: "c3", name: "Derivatives" }],
  mistakes: [{ diagnosisId: "d1", question: "Q?", chosen: "C", correct: "B", errorType: "misconception", summary: "s", suspectedMisconception: null, confidence: 0.7 }],
  previousMarkdown: null, date: "2026-09-20",
};
const GOOD = "You picked C, which suggests you differentiated only one factor of the product. The product rule says (fg)' = f'g + fg'.";
const PASS = JSON.stringify({ verdict: "pass", objections: [] });

describe("draft / revise", () => {
  it("return the cleaned model text, using the main tier at a low temperature", async () => {
    const r = routedLlm({ write_section: [`\`\`\`markdown\n${GOOD}\n\`\`\``], revise_section: [`<think>x</think>${GOOD}!`] });
    const steps = createNoteSteps({ llm: r.llm });
    expect(await steps.draft({ input })).toBe(GOOD);
    expect(await steps.revise({ input, draft: GOOD, objections: ["[unclear] x"], clarifications: [] })).toBe(`${GOOD}!`);
    expect(r.calls.map((c) => [c.tier, c.temperature])).toEqual([["main", 0.3], ["main", 0.3]]);
  });

  it("an empty reply is an error (the run becomes retryable), not an empty note", async () => {
    const steps = createNoteSteps({ llm: routedLlm({ write_section: ["  <think>only thoughts</think> "] }).llm });
    await expect(steps.draft({ input })).rejects.toThrow(/empty reply for the "draft" step/);
  });

  it("tiers can be overridden per step", async () => {
    const r = routedLlm({ write_section: [GOOD] });
    await createNoteSteps({ llm: r.llm, tiers: { draft: "heavy" } }).draft({ input });
    expect(r.calls[0]?.tier).toBe("heavy");
  });
});

describe("review", () => {
  it("code checks short-circuit: no model call for a bad link or a too-short section", async () => {
    const r = routedLlm({});
    const steps = createNoteSteps({ llm: r.llm });
    const bad = await steps.review({ input, draft: `${GOOD} See [[Made Up]].`, clarifications: [] });
    expect(bad).toMatchObject({ accepted: false });
    expect(bad.objections[0]).toMatch(/^\[links\]/);
    expect((await steps.review({ input, draft: "short", clarifications: [] })).objections[0]).toMatch(/^\[format\]/);
    expect(r.calls).toHaveLength(0);
  });

  it("asks the main tier at temperature 0 and maps pass / revise / needs_clarification", async () => {
    const r = routedLlm({ review_section: [
      PASS,
      JSON.stringify({ verdict: "revise", objections: [{ kind: "inaccurate", message: "Wrong." }] }),
      JSON.stringify({ verdict: "needs_clarification", objections: [], clarifyingQuestion: "Why C?" }),
    ] });
    const steps = createNoteSteps({ llm: r.llm });
    const args = { input, draft: GOOD, clarifications: [] };
    expect(await steps.review(args)).toEqual({ accepted: true, objections: [] });
    expect(await steps.review(args)).toEqual({ accepted: false, objections: ["[inaccurate] Wrong."] });
    expect(await steps.review(args)).toEqual({ accepted: false, objections: [], needsClarification: true, clarifyingQuestion: "Why C?" });
    expect(r.calls.every((c) => c.tier === "main" && c.temperature === 0)).toBe(true);
  });

  it("repairs a malformed reviewer reply once, and sends the reviewer the student's earlier answers", async () => {
    const r = routedLlm({ review_section: ["Looks fine to me!", PASS] });
    const steps = createNoteSteps({ llm: r.llm });
    const out = await steps.review({ input, draft: GOOD, clarifications: [{ question: "Why C?", answer: "I thought X" }] });
    expect(out.accepted).toBe(true);
    expect(r.count("review_section")).toBe(2);
    expect(r.prompt("review_section", 0)).toContain("<student_answer>\nI thought X\n</student_answer>");
  });
});

describe("ask", () => {
  it("reuses the reviewer's question without a model call", async () => {
    const r = routedLlm({});
    const q = await createNoteSteps({ llm: r.llm }).ask({ input, draft: GOOD, objections: [], clarifications: [], stopReason: "reviewer", suggestedQuestion: "  Why C?  " });
    expect(q).toBe("Why C?");
    expect(r.calls).toHaveLength(0);
  });
  it("otherwise has the model write one", async () => {
    const r = routedLlm({ ask_student: ["  What did you picture happening to the second factor?  "] });
    const q = await createNoteSteps({ llm: r.llm }).ask({ input, draft: GOOD, objections: ["[unclear] x"], clarifications: [], stopReason: "budget", suggestedQuestion: null });
    expect(q).toBe("What did you picture happening to the second factor?");
    expect(r.calls[0]?.tier).toBe("main");
  });
});
