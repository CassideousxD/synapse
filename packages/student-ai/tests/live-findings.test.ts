import { createMemoryCheckpointStore } from "@synapse/agent-runtime";
import type { Attempt, ConceptNode } from "@synapse/contracts";
import { createMemoryNoteStore } from "@synapse/note-store";
import { describe, expect, it } from "vitest";
import { runLive } from "../scripts/live-lib";
import { buildReviewMessages, buildReviseMessages, buildSectionMessages } from "../src/note-prompts";
import { createNoteSteps } from "../src/note-steps";
import type { NoteRunInput } from "../src/note-types";
import { createNoteUpdater } from "../src/note-updater";
import { stripLeadingUpdateHeading } from "../src/text";
import type { QuestionContext } from "../src/types";
import { routedLlm } from "./routed-llm";

/** Regression tests for what the first real-model run (pnpm test:live) turned up. */

const GOOD = "You picked C, which suggests you differentiated only one factor of the product. The product rule says (fg)' = f'g + fg'.";
const DIAG = JSON.stringify({ errorType: "misconception", summary: "Differentiates only one factor.", suspectedMisconception: "Believes (fg)' = f·g'.", confidence: 0.8 });

const input: NoteRunInput = {
  studentId: "s1", cycleId: "t1",
  concept: { id: "c1", name: "Product Rule", summary: "How to differentiate a product." },
  linkable: [{ id: "c1", name: "Product Rule" }, { id: "c2", name: "Chain Rule" }],
  mistakes: [{ diagnosisId: "d1", question: "Q?", chosen: "C", correct: "B", errorType: "misconception", summary: "s", suspectedMisconception: null, confidence: 0.7 }],
  previousMarkdown: null, date: "2026-09-21",
};
const sys = (ms: { content: string }[]) => ms[0]?.content ?? "";

describe("finding: real models fill clarifyingQuestion with an empty string (repaired almost every review)", () => {
  it("a 'pass' with a blank clarifyingQuestion is accepted on the first try, with no repair call", async () => {
    const r = routedLlm({ review_section: ['{\n  "verdict": "pass",\n  "objections": [],\n  "clarifyingQuestion": ""\n}'] });
    const out = await createNoteSteps({ llm: r.llm }).review({ input, draft: GOOD, clarifications: [] });
    expect(out).toEqual({ accepted: true, objections: [] });
    expect(r.count("review_section")).toBe(1);
  });

  it("the reviewer prompt shows three concrete shapes, not a template that invites the empty key", () => {
    const p = sys(buildReviewMessages(input, "s", []));
    expect(p).toContain('{"verdict": "pass", "objections": []}');
    expect(p).toContain('"clarifyingQuestion": "..."}');
    expect(p).not.toContain('"clarifyingQuestion": string');
  });

  it("through the whole pipeline: blank questions on every review still give a saved note with one review call", async () => {
    const q1: QuestionContext = { questionId: "q1", stem: "What is d/dx of x·sin(x)?", options: [{ id: "B", text: "sin(x) + x·cos(x)" }, { id: "C", text: "x·cos(x)" }] };
    const concept: ConceptNode = { id: "c1", name: "Product Rule", summary: "How to differentiate a product." };
    const attempt: Attempt = { id: "a1", studentId: "s1", testId: "t1", conceptId: "c1", questionId: "q1", selectedOption: "C", correctOption: "B", isCorrect: false, submittedAt: "2026-09-21T09:00:00Z" };
    const r = routedLlm({ diagnose: [DIAG], write_section: [GOOD], review_section: ['{"verdict":"pass","objections":[],"clarifyingQuestion":""}'] });
    const updater = createNoteUpdater({
      llm: r.llm, notes: createMemoryNoteStore(),
      checkpoints: createMemoryCheckpointStore<NoteRunInput, string, string, string>(),
    });
    const res = await updater.update({ studentId: "s1", concept, attempts: [attempt], questions: [q1], curriculum: [concept] });
    expect(res.status).toBe("saved");
    expect(r.count("review_section")).toBe(1);
  });

  it("needs_clarification with no question is legal: the ask step writes one", async () => {
    const q1: QuestionContext = { questionId: "q1", stem: "What is d/dx of x·sin(x)?", options: [{ id: "B", text: "sin(x) + x·cos(x)" }, { id: "C", text: "x·cos(x)" }] };
    const concept: ConceptNode = { id: "c1", name: "Product Rule", summary: "How to differentiate a product." };
    const attempt: Attempt = { id: "a1", studentId: "s1", testId: "t1", conceptId: "c1", questionId: "q1", selectedOption: "C", correctOption: "B", isCorrect: false, submittedAt: "2026-09-21T09:00:00Z" };
    const r = routedLlm({
      diagnose: [DIAG], write_section: [GOOD],
      review_section: ['{"verdict":"needs_clarification","objections":[],"clarifyingQuestion":""}'],
      ask_student: ["  What did you picture happening to the second factor?  "],
    });
    const updater = createNoteUpdater({
      llm: r.llm, notes: createMemoryNoteStore(),
      checkpoints: createMemoryCheckpointStore<NoteRunInput, string, string, string>(),
    });
    const res = await updater.update({ studentId: "s1", concept, attempts: [attempt], questions: [q1], curriculum: [concept] });
    expect(res).toMatchObject({ status: "needs_answer", question: "What did you picture happening to the second factor?" });
    expect(r.count("ask_student")).toBe(1);
  });
});

describe("finding: the model wrote its own '## Update N · date' heading (with an invented date)", () => {
  it("stripLeadingUpdateHeading removes leading Update headings, but only those", () => {
    expect(stripLeadingUpdateHeading("## Update 2 · 2026-09-24\n\nBody")).toBe("Body");
    expect(stripLeadingUpdateHeading("  \n# Update 1\nBody")).toBe("Body");
    expect(stripLeadingUpdateHeading("### Update 3\n## Update 4 · x\n\nBody")).toBe("Body");
    expect(stripLeadingUpdateHeading("## Update rule for gradient descent\n\nBody")).toBe("## Update rule for gradient descent\n\nBody");
    expect(stripLeadingUpdateHeading("Intro\n\n## Update 2 · d\n\nBody")).toBe("Intro\n\n## Update 2 · d\n\nBody");
    expect(stripLeadingUpdateHeading("## Update 2 · d")).toBe("## Update 2 · d");
  });

  it("draft and revise apply it to the model's reply", async () => {
    const r = routedLlm({
      write_section: [`## Update 2 · 2026-09-24\n\n${GOOD}`],
      revise_section: [`### Update 2\n\n${GOOD} More.`],
    });
    const steps = createNoteSteps({ llm: r.llm });
    expect(await steps.draft({ input })).toBe(GOOD);
    expect(await steps.revise({ input, draft: GOOD, objections: ["[unclear] x"], clarifications: [] })).toBe(`${GOOD} More.`);
  });

  it("both writing prompts tell the model not to write one", () => {
    for (const built of [buildSectionMessages(input), buildReviseMessages(input, "d", [], [])]) {
      expect(sys(built)).toContain("Do not write a heading for the update itself");
    }
  });
});

describe("finding: the model writes LaTeX and appends a list of links, including to the note's own concept", () => {
  it("both writing prompts ask for plain-text math and inline links", () => {
    for (const built of [buildSectionMessages(input), buildReviseMessages(input, "d", [], [])]) {
      expect(sys(built)).toContain("Do not use LaTeX");
      expect(sys(built)).toContain("inline, in the sentence where they come up");
      expect(sys(built)).toContain("Do not add a list of links at the end");
    }
  });

  it("the note's own concept is never offered as a link target", () => {
    const user = buildSectionMessages(input)[1]?.content ?? "";
    expect(user).toContain("Concepts you may link to: [[Chain Rule]]");
    expect(user).not.toContain("[[Product Rule]]");
    const alone = { ...input, linkable: [{ id: "c1", name: "Product Rule" }] };
    expect(buildSectionMessages(alone)[1]?.content).toContain("(none, use no links)");
  });
});

describe("live harness additions", () => {
  const SECTION =
    "You picked x·cos(x), which suggests you differentiated only one factor of the product and left the other alone.\n\n" +
    "The product rule says (fg)' = f'g + fg'. See [[Chain Rule]] for composites. That is why the second term matters in every product.\n\n" +
    "Check yourself: what is d/dx of x·ln(x)?";
  const PASS = JSON.stringify({ verdict: "pass", objections: [] });
  const REVISE = JSON.stringify({ verdict: "revise", objections: [{ kind: "inaccurate", message: "The product rule is stated wrongly." }] });
  const find = (checks: { name: string; ok: boolean; soft: boolean }[], part: string) => checks.find((c) => c.name.includes(part));

  it("scenario D plants a bad draft; a reviewer that objects earns the check, and the run passes", async () => {
    const r = routedLlm({ diagnose: [DIAG], revise_section: [SECTION], review_section: [REVISE, PASS] });
    const report = await runLive(r.llm, { scenarios: ["d"], log: () => {} });
    expect(report.ok).toBe(true);
    expect(report.calls.filter((c) => c.injected).map((c) => c.task)).toEqual(["write_section"]);
    expect(find(report.checks, "the reviewer objected to the planted error")).toMatchObject({ ok: true, soft: true });
    expect(find(report.checks, "states the correct product rule")).toMatchObject({ ok: true, soft: true });
    expect(r.prompt("review_section", 0)).toContain("product of the derivatives");
  });

  it("scenario D: a reviewer that passes the planted error only produces a warning, not a failure", async () => {
    const r = routedLlm({ diagnose: [DIAG], review_section: [PASS] });
    const report = await runLive(r.llm, { scenarios: ["d"], log: () => {} });
    expect(report.ok).toBe(true);
    expect(find(report.checks, "the reviewer objected to the planted error")).toMatchObject({ ok: false, soft: true });
  });

  it("new soft checks warn about LaTeX, an own 'Update' heading, and a link to the note's own concept", async () => {
    const LATEX =
      "You picked \\(x\\cos(x)\\), which suggests you differentiated only one factor of the product and left the other alone. See [[Product Rule]] for the rule.\n\n" +
      "The product rule says (fg)' = f'g + fg'. That is why the second term matters in every product you will meet.\n\n" +
      "Check yourself: what is d/dx of x·ln(x)?";
    const r = routedLlm({ diagnose: [DIAG], write_section: [LATEX], review_section: [PASS] });
    const report = await runLive(r.llm, { scenarios: ["a"], log: () => {} });
    expect(report.ok).toBe(true);
    expect(find(report.checks, "no LaTeX")).toMatchObject({ ok: false, soft: true });
    expect(find(report.checks, "does not link to its own concept")).toMatchObject({ ok: false, soft: true });
    expect(find(report.checks, "wrote no 'Update N' heading")).toMatchObject({ ok: true, soft: true });
  });
});
