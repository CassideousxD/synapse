import { createMemoryCheckpointStore } from "@synapse/agent-runtime";
import type { Attempt, ConceptNode } from "@synapse/contracts";
import { createMemoryNoteStore } from "@synapse/note-store";
import { describe, expect, it } from "vitest";
import { runLive, type LiveReport, type Scenario } from "../scripts/live-lib";
import { diagnoseAttempt } from "../src/diagnosis";
import { buildAskMessages, buildReviseMessages, buildSectionMessages } from "../src/note-prompts";
import { createNoteSteps } from "../src/note-steps";
import type { NoteRunInput } from "../src/note-types";
import { createNoteUpdater, tailoredNoteValidator, type NoteUpdateResult, type UpdateRequest } from "../src/note-updater";
import { extractTagged, looksLikeReasoning } from "../src/text";
import type { QuestionContext } from "../src/types";
import { routedLlm, type Reply, type Task } from "./routed-llm";

/** Regression tests for the third real-model run: an 859-word reasoning monologue was saved as a student's note. */

// The start of the actual runaway reply from scenario B (no <think> tags, cut off mid-sentence).
const JUNK =
  'We need to revise the section to correct the inaccuracies. The student actually said they thought differentiate first part and leave second unchanged. ' +
  'Wait: The student answer says: "I thought you differentiate the first part and just leave the second part as it is." That matches the original claim: ' +
  'they thought differentiate first part and leave second unchanged. But their answer x·cos(x) suggests they differentiated second part and left first unchanged. ' +
  "However the student answer says they thought differentiate first part and leave second unchanged. There's a mismatch. The objection says the section claims they " +
  "thought differentiate first part and leave second unchanged, but the student's answer shows they differentiated second part and left first unchanged. " +
  'So the objection is inaccurate. However we must follow instructions: fix every objection.';

// Genuine good notes from the live runs. The detector must never flag these.
const GOOD_NOTES = [
  "You chose x·cos(x) for the derivative of x·sin(x), which suggests you thought the derivative of x is 0 so only the sin(x) factor contributed.  \nThat belief doesn’t hold because the derivative of x is actually 1, not 0. When you apply the product rule to x·sin(x) you must differentiate each factor: the derivative of x times sin(x) plus x times the derivative of sin(x).  \nSo d/dx[x·sin(x)] = (1)·sin(x) + x·cos(x) = sin(x) + x·cos(x). A quick check with a simpler product, like x·1, gives 1·1 + x·0 = 1, confirming that the derivative of x is 1.  \nWhen you see a product, do you remember to differentiate each factor and add the two results? [[Derivative Basics]]",
  "You chose x·cos(x). For f = x and g = sin(x), the product rule gives (fg)' = f'g + fg' = 1·sin(x) + x·cos(x) = sin(x) + x·cos(x). Your answer included the second term x·cos(x) but missed the first term sin(x). Adding sin(x) gives the correct derivative.\n\nCheck yourself: what is d/dx of x·ln(x)?\n\n[[Derivative Basics]]",
  "You chose x·cos(x). The product rule says that the derivative of a product f·g is f'·g + f·g', not just f·g'. For x·sin(x), let f = x and g = sin(x). Then f' = 1 and g' = cos(x), so the derivative is 1·sin(x) + x·cos(x) = sin(x) + x·cos(x). Your answer missed the sin(x) term because it omitted the f'·g part.\n\nCheck yourself: what is d/dx of x·ln(x)? (Hint: derivative of x is 1, derivative of ln(x) is 1/x.) [[Derivative Basics]]",
  "You said you thought you differentiate the first part and just leave the second part as it is. That’s why you chose x·cos(x) for d/dx[x·sin(x)]. The product rule actually has two pieces: derivative of the first times the second, plus the first times derivative of the second. Next time, ask yourself: did I include both “derivative of first times second” and “first times derivative of second”?",
  "You chose 2x·eˣ, which suggests you think the derivative of a product is just the derivative of the first factor times the second (f'g).  \n\nThat belief misses the part where the second function changes. Let's check with a simpler product: differentiate x·eˣ. f=x, g=eˣ, f'=1, g'=eˣ, giving 1·eˣ + x·eˣ. When you differentiate a product, ask yourself: did you include both terms?",
];

const GOOD = "You picked C, which suggests you differentiated only one factor of the product. The product rule says (fg)' = f'g + fg'.";
const GOOD_2 = "Revised: you picked C, which treats the product like a single factor. The product rule says (fg)' = f'g + fg'. See [[Chain Rule]] for composites.";
const LONG = `${GOOD}\n\n${"More detail that goes on and on. ".repeat(100)}`;
const DIAG = JSON.stringify({ errorType: "misconception", summary: "Differentiates only one factor.", suspectedMisconception: "Believes (fg)' = f·g'.", confidence: 0.8 });
const PASS = JSON.stringify({ verdict: "pass", objections: [] });
const revise = (m: string) => JSON.stringify({ verdict: "revise", objections: [{ kind: "inaccurate", message: m }] });
const tag = (s: string) => `<note_section>\n${s}\n</note_section>`;

const concept: ConceptNode = { id: "c1", name: "Product Rule", summary: "How to differentiate a product." };
const curriculum: ConceptNode[] = [concept, { id: "c2", name: "Chain Rule", summary: "Composites." }];
const q1: QuestionContext = { questionId: "q1", stem: "What is d/dx of x·sin(x)?", options: [{ id: "B", text: "sin(x) + x·cos(x)" }, { id: "C", text: "x·cos(x)" }] };
const attempt: Attempt = { id: "a1", studentId: "s1", testId: "t1", conceptId: "c1", questionId: "q1", selectedOption: "C", correctOption: "B", isCorrect: false, submittedAt: "2026-09-21T09:00:00Z" };
const req: UpdateRequest = { studentId: "s1", concept, attempts: [attempt], questions: [q1], curriculum };

function harness(script: Partial<Record<Task, Reply[]>>, config?: Parameters<typeof createNoteUpdater>[0]["config"]) {
  const r = routedLlm(script);
  const notes = createMemoryNoteStore();
  const checkpoints = createMemoryCheckpointStore<NoteRunInput, string, string, string>();
  let ids = 0;
  const updater = createNoteUpdater({
    llm: r.llm, notes, checkpoints,
    now: () => new Date("2026-09-21T10:00:00Z"),
    newId: () => `diag-${++ids}`,
    ...(config ? { config } : {}),
  });
  return { ...r, notes, checkpoints, updater };
}
const saved = (r: NoteUpdateResult) => {
  if (r.status !== "saved") throw new Error(`expected saved, got ${JSON.stringify(r)}`);
  return r;
};

const input: NoteRunInput = {
  studentId: "s1", cycleId: "t1", concept: { id: "c1", name: "Product Rule", summary: "x" },
  linkable: [{ id: "c2", name: "Chain Rule" }],
  mistakes: [{ diagnosisId: "d1", question: "Q?", chosen: "C", correct: "B", errorType: "misconception", summary: "s", suspectedMisconception: null, confidence: 0.7 }],
  previousMarkdown: null, date: "2026-09-21",
};

describe("extractTagged", () => {
  it("returns what is inside the tags", () => {
    expect(extractTagged("<note_section>\nHello\n</note_section>", "note_section")).toBe("Hello");
  });
  it("ignores reasoning before the tags, and keeps the LAST complete block", () => {
    expect(extractTagged("Let me think... <note_section>draft</note_section> hmm no. <note_section>final</note_section>", "note_section")).toBe("final");
    expect(extractTagged("I will wrap it in <note_section> tags. <note_section>real</note_section>", "note_section")).toBe("real");
  });
  it("returns null when the last block was never closed (the reply was cut off)", () => {
    expect(extractTagged("<note_section>Half a sentence and then", "note_section")).toBeNull();
    expect(extractTagged("<note_section>a</note_section> more <note_section>b, cut off", "note_section")).toBeNull();
  });
  it("is lenient about a missing opening tag, and about case", () => {
    expect(extractTagged("Hello</note_section>", "note_section")).toBe("Hello");
    expect(extractTagged("<NOTE_SECTION>Hi</Note_Section>", "note_section")).toBe("Hi");
  });
  it("drops <think> blocks first, even if they contain tags", () => {
    expect(extractTagged("<think><note_section>wrong</note_section></think><note_section>right</note_section>", "note_section")).toBe("right");
  });
  it("uses the whole reply when there are no tags at all", () => {
    expect(extractTagged("Just text", "note_section")).toBe("Just text");
  });
});

describe("looksLikeReasoning", () => {
  it("flags the real runaway reply from the live run", () => {
    expect(looksLikeReasoning(JUNK)).toBe(true);
  });
  it.each(GOOD_NOTES.map((n, i) => [i, n] as const))("does not flag genuine good note #%i", (_i, note) => {
    expect(looksLikeReasoning(note)).toBe(false);
  });
  it("flags echoed prompt delimiters and TASK lines", () => {
    expect(looksLikeReasoning("You chose C. <current_section> stuff </current_section>")).toBe(true);
    expect(looksLikeReasoning("Fine note.\nTASK: write_section\nmore")).toBe(true);
  });
  it("flags a reply that starts like an inner monologue", () => {
    for (const s of ["We need to write a section about the product rule.", "Okay, so the student picked C.", "Hmm, the answer is odd.", "I need to fix the objections."]) {
      expect(looksLikeReasoning(s)).toBe(true);
    }
  });
  it("one marker alone is not enough, two are", () => {
    expect(looksLikeReasoning("You chose C. Wait: that is the wrong sign, so redo it.")).toBe(false);
    expect(looksLikeReasoning("The objection says the sign is wrong. Wait: it is right.")).toBe(true);
  });
  it("friendly phrasing that a real note might use is fine", () => {
    expect(looksLikeReasoning("You chose C. Let's check with x·1: its derivative is 1. We should always add both terms.")).toBe(false);
  });
});

describe("note steps: tag protocol, token caps and junk handling", () => {
  it("draft uses what is inside <note_section>, ignoring reasoning around it", async () => {
    const r = routedLlm({ write_section: [`I will think first. Actually let me plan.\n${tag(GOOD)}\nDone.`] });
    expect(await createNoteSteps({ llm: r.llm }).draft({ input })).toBe(GOOD);
  });

  it("every model call has an explicit token cap", async () => {
    const r = routedLlm({
      diagnose: [DIAG], write_section: [tag(GOOD)], revise_section: [tag(GOOD_2)], review_section: [PASS],
      ask_student: ["<question>What did you picture?</question>"],
    });
    const steps = createNoteSteps({ llm: r.llm });
    await steps.draft({ input });
    await steps.revise({ input, draft: GOOD, objections: ["[unclear] x"], clarifications: [] });
    await steps.review({ input, draft: GOOD, clarifications: [] });
    expect(await steps.ask({ input, draft: GOOD, objections: [], clarifications: [], stopReason: "budget", suggestedQuestion: null })).toBe("What did you picture?");
    await diagnoseAttempt({ llm: r.llm }, { attempt, question: q1, concept });
    expect(r.calls.map((c) => [c.task, c.maxTokens])).toEqual([
      ["write_section", 1800], ["revise_section", 1800], ["review_section", 1200], ["ask_student", 400], ["diagnose", 800],
    ]);
  });

  it("a reply cut off before the closing tag is an error, without a second call", async () => {
    const r = routedLlm({ write_section: ["<note_section>You chose C, which suggests you differentiated only one fac"] });
    await expect(createNoteSteps({ llm: r.llm }).draft({ input })).rejects.toThrow(/cut off before it finished/);
    expect(r.count("write_section")).toBe(1);
  });

  it("an untagged reasoning monologue is re-asked once, and the retry shows the model what went wrong", async () => {
    const r = routedLlm({ write_section: [JUNK, GOOD] });
    expect(await createNoteSteps({ llm: r.llm }).draft({ input })).toBe(GOOD);
    expect(r.count("write_section")).toBe(2);
    const retry = r.calls[1]!.messages;
    expect(retry.at(-1)?.content).toContain("contained your reasoning about the task");
    expect(retry.at(-2)?.role).toBe("assistant");
    expect(retry.at(-2)?.content.length).toBeLessThanOrEqual(1500 + 30);
  });

  it("if it is still reasoning, the step fails instead of returning junk (and revise behaves the same)", async () => {
    const r = routedLlm({ write_section: [JUNK], revise_section: [JUNK] });
    const steps = createNoteSteps({ llm: r.llm });
    await expect(steps.draft({ input })).rejects.toThrow(/kept writing its reasoning/);
    await expect(steps.revise({ input, draft: GOOD, objections: ["[unclear] x"], clarifications: [] })).rejects.toThrow(/kept writing its reasoning/);
    expect(r.count("write_section")).toBe(2);
  });

  it("a question for the student is not subject to the reasoning heuristics", async () => {
    const r = routedLlm({ ask_student: ["<question>Let me ask: what did you picture happening to the second factor?</question>"] });
    const q = await createNoteSteps({ llm: r.llm }).ask({ input, draft: GOOD, objections: [], clarifications: [], stopReason: "budget", suggestedQuestion: null });
    expect(q).toBe("Let me ask: what did you picture happening to the second factor?");
  });

  it("the prompts ask for the tags", () => {
    expect(buildSectionMessages(input)[0]?.content).toContain("<note_section>");
    expect(buildReviseMessages(input, "d", [], [])[0]?.content).toContain("<note_section>");
    expect(buildAskMessages(input, "d", [], [], "budget")[0]?.content).toContain("<question>");
  });
});

describe("pipeline: never save junk", () => {
  it("a reviser that only produces reasoning fails the step; the last good draft stays and the retry builds on it", async () => {
    const h = harness({
      diagnose: [DIAG], write_section: [GOOD],
      revise_section: [JUNK, JUNK, GOOD_2],
      review_section: [revise("The formula is stated wrongly."), PASS],
    });
    const failed = await h.updater.update(req);
    expect(failed).toMatchObject({ status: "failed", during: "revising" });
    expect(failed.status === "failed" && failed.message).toMatch(/kept writing its reasoning/);
    expect(await h.notes.list()).toEqual([]);

    const runId = failed.status === "failed" ? failed.runId : "";
    expect((await h.checkpoints.load(runId))?.draft).toBe(GOOD);

    const done = saved(await h.updater.retry(runId));
    expect(done).toMatchObject({ provisional: false, fallback: false });
    expect(done.note.markdown).toContain("Revised: you picked C");
    expect(done.note.markdown).not.toContain("We need to revise");
    expect(h.prompt("revise_section", 2)).toContain(`<current_section>\n${GOOD}\n</current_section>`);
    expect(h.prompt("revise_section", 2)).not.toContain("We need to revise");
  });

  it("giving up with a draft that fails the hard checks saves a plain summary of the mistake instead", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [LONG] }, { maxRevisions: 0, maxClarifications: 0 });
    const r = saved(await h.updater.update(req));
    expect(r).toMatchObject({ provisional: true, fallback: true });
    const md = r.note.markdown;
    expect(md).toContain("## Update 1 · 2026-09-21");
    expect(md).toContain("automatic summary of your mistake");
    expect(md).toContain('For the question "What is d/dx of x·sin(x)?" you chose **x·cos(x)**, but the correct answer is **sin(x) + x·cos(x)**.');
    expect(md).toContain("What probably happened: Differentiates only one factor.");
    expect(md).toContain("A belief that may be behind this: Believes (fg)' = f·g'.");
    expect(md).not.toContain("More detail that goes on");
    expect(tailoredNoteValidator.validate(r.note).ok).toBe(true);
    expect(h.count("review_section")).toBe(0); // the code check rejected it before any reviewer was paid
  });

  it("the fallback can't smuggle in a link outside the curriculum", async () => {
    const linky = JSON.stringify({ errorType: "misconception", summary: "Confuses this with [[Made Up]].", suspectedMisconception: "Thinks [[Other Thing]] applies.", confidence: 0.6 });
    const h = harness({ diagnose: [linky], write_section: [LONG] }, { maxRevisions: 0, maxClarifications: 0 });
    const r = saved(await h.updater.update(req));
    expect(r.fallback).toBe(true);
    expect(r.note.markdown).toContain("Confuses this with Made Up.");
    expect(r.note.markdown).not.toMatch(/\[\[(Made Up|Other Thing)\]\]/);
    expect(r.note.linkedConceptIds).toEqual([]);
  });

  it("last line of defence: even an 'accepted' draft that reads like reasoning is replaced by the fallback", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [GOOD], review_section: [JSON.stringify({ verdict: "needs_clarification", objections: [], clarifyingQuestion: "Why C?" })] });
    const asked = await h.updater.update(req);
    expect(asked.status).toBe("needs_answer");
    const runId = asked.status === "needs_answer" ? asked.runId : "";
    const state = (await h.checkpoints.load(runId))!;
    await h.checkpoints.save({ ...state, phase: "accepted", question: null, draft: `Okay, so the student picked C. ${GOOD}` });

    const r = saved(await h.updater.update(req));
    expect(r).toMatchObject({ provisional: true, fallback: true });
    expect(r.note.markdown).not.toContain("Okay, so the student");
    expect(r.note.markdown).toContain("automatic summary");
  });

  it("the fallback is saved once: calling update again changes nothing and calls no model", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [LONG] }, { maxRevisions: 0, maxClarifications: 0 });
    const first = saved(await h.updater.update(req));
    const calls = h.calls.length;
    const again = saved(await h.updater.update(req));
    expect(again.note).toEqual(first.note);
    expect(again.fallback).toBe(true);
    expect(h.calls.length).toBe(calls);
    expect(await h.notes.history("c1")).toHaveLength(1);
  });

  it("an ordinary provisional note (clean draft, reviewer never satisfied) is not the fallback", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [GOOD], review_section: [revise("still not right")] }, { maxRevisions: 0, maxClarifications: 0 });
    const r = saved(await h.updater.update(req));
    expect(r).toMatchObject({ provisional: true, fallback: false });
    expect(r.note.markdown).toContain("this update could not be fully checked");
    expect(r.note.markdown).toContain("You picked C, which suggests");
  });
});

describe("live harness", () => {
  const SECTION =
    "You picked x·cos(x), which suggests you differentiated only one factor of the product and left the other alone.\n\n" +
    "The product rule says (fg)' = f'g + fg'. See [[Chain Rule]] for composites. That is why the second term matters in every product.\n\n" +
    "Check yourself: what is d/dx of x·ln(x)?";
  const CLARIFY_Q = "What did you picture happening to the second factor?";

  async function run(script: Partial<Record<Task, Reply[]>>, scenarios: Scenario[]) {
    const fake = routedLlm(script);
    const lines: string[] = [];
    const report: LiveReport = await runLive(fake.llm, { scenarios, log: (l) => lines.push(l) });
    return { fake, report, lines };
  }
  const find = (r: LiveReport, part: string) => r.checks.find((c) => c.name.includes(part));

  it("B's canned answer agrees with the option the student picked; F's deliberately does not", async () => {
    const b = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [SECTION], review_section: [PASS] }, ["b"]);
    expect(b.fake.prompt("revise_section")).toContain("I thought you only differentiate the second part, sin(x), and just leave the first part, x, as it is.");
    const f = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [SECTION], review_section: [PASS] }, ["f"]);
    expect(f.fake.prompt("revise_section")).toContain("I thought you differentiate the first part and just leave the second part as it is.");
    expect(f.lines.join("\n")).toContain("contradictory answer:");
  });

  it("F: a clean run passes", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [SECTION], review_section: [PASS] }, ["f"]);
    expect(t.report.ok).toBe(true);
  });

  it("F: a reviser that only produces reasoning ends in a clean failure, reported as a warning, with nothing saved", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [JUNK], review_section: [PASS] }, ["f"]);
    expect(t.report.ok).toBe(true);
    expect(find(t.report, "nothing was saved unless it passed the checks")).toMatchObject({ ok: true, soft: false });
    expect(find(t.report, "the run produced a note")).toMatchObject({ ok: false, soft: true });
  });

  it("a note saved via the fallback still passes the hard checks, and is flagged as provisional (a warning)", async () => {
    const t = await run(
      { diagnose: [DIAG], write_section: [LONG], revise_section: [LONG], review_section: [PASS], ask_student: [`<question>${CLARIFY_Q}</question>`] },
      ["a"],
    );
    expect(t.report.ok).toBe(true);
    expect(find(t.report, "the saved section passes the deterministic checks")).toMatchObject({ ok: true, soft: false });
    expect(find(t.report, "no model reasoning leaked into the note")).toMatchObject({ ok: true, soft: false });
    expect(find(t.report, "the note is not provisional")).toMatchObject({ ok: false, soft: true, detail: expect.stringContaining("fallback") });
  });

  it("D's 'correct product rule' check accepts middle dots and asterisks in the formula", async () => {
    const dotted =
      "You chose x·cos(x). The product rule says that the derivative of f·g is f'·g + f·g', not just f·g'. Here that gives 1·sin(x) + x·cos(x). " +
      "Your answer missed the sin(x) term. Check yourself: what is d/dx of x·ln(x)?";
    const t = await run({ diagnose: [DIAG], revise_section: [dotted], review_section: [revise("It states the rule wrongly."), PASS] }, ["d"]);
    expect(find(t.report, "states the correct product rule")).toMatchObject({ ok: true, soft: true });
  });

  it("each writing call is logged with whether the model followed the tag protocol", async () => {
    const tagged = routedLlm({ diagnose: [DIAG], write_section: [tag(SECTION)], review_section: [PASS] });
    const lines: string[] = [];
    await runLive(tagged.llm, { scenarios: ["a"], log: (l) => lines.push(l) });
    expect(lines.find((l) => l.includes("<- write_section"))).toContain(" tags=yes");
    const untagged = routedLlm({ diagnose: [DIAG], write_section: [SECTION], review_section: [PASS] });
    const lines2: string[] = [];
    await runLive(untagged.llm, { scenarios: ["a"], log: (l) => lines2.push(l) });
    expect(lines2.find((l) => l.includes("<- write_section"))).toContain(" tags=NO");
    expect(lines2.find((l) => l.includes("<- diagnose"))).not.toMatch(/tags=/);
    expect(lines2.find((l) => l.includes("<- review_section"))).not.toMatch(/tags=/);
  });

  it("long replies and usage are logged for diagnosis", async () => {
    const r = routedLlm({ diagnose: [DIAG], write_section: [SECTION], review_section: [PASS] });
    const withUsage = {
      async chat(req: Parameters<typeof r.llm.chat>[0]) {
        const res = await r.llm.chat(req);
        return { ...res, usage: { promptTokens: 10, completionTokens: 42 } };
      },
    };
    const lines: string[] = [];
    await runLive(withUsage, { scenarios: ["a"], log: (l) => lines.push(l) });
    expect(lines.join("\n")).toContain('usage={"promptTokens":10,"completionTokens":42}');
    const long = routedLlm({ diagnose: [DIAG], write_section: [`${SECTION}\n\n${"filler ".repeat(500)}`], revise_section: [SECTION], review_section: [PASS] });
    const lines2: string[] = [];
    await runLive(long.llm, { scenarios: ["a"], log: (l) => lines2.push(l) });
    expect(lines2.join("\n")).toMatch(/long reply \(\d+ chars\)\. Starts: .* \.\.\. Ends: /);
  });
});
