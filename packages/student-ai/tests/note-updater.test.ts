import { createMemoryCheckpointStore, InvalidTransitionError, RunNotFoundError, type RunConfig } from "@synapse/agent-runtime";
import type { Attempt, ConceptNode } from "@synapse/contracts";
import { createMemoryNoteStore } from "@synapse/note-store";
import { describe, expect, it } from "vitest";
import { isPreserved } from "../src/compose";
import { LlmOutputError } from "../src/json";
import type { NoteRunInput } from "../src/note-types";
import { createNoteUpdater, tailoredNoteValidator, type NoteUpdateResult, type UpdateRequest } from "../src/note-updater";
import type { QuestionContext } from "../src/types";
import { routedLlm, type Reply, type Task } from "./routed-llm";

// ---------- fixtures ----------
const concept: ConceptNode = { id: "c1", name: "Product Rule", summary: "How to differentiate a product of two functions." };
const curriculum: ConceptNode[] = [
  concept,
  { id: "c2", name: "Chain Rule", summary: "Derivative of a composite function." },
  { id: "c3", name: "Derivatives", summary: "Rates of change." },
];
const q1: QuestionContext = {
  questionId: "q1", stem: "What is d/dx of x·sin(x)?",
  options: [{ id: "A", text: "cos(x)" }, { id: "B", text: "sin(x) + x·cos(x)" }, { id: "C", text: "x·cos(x)" }],
};
const attemptFor = (testId: string, id: string, over: Partial<Attempt> = {}): Attempt => ({
  id, studentId: "stu-SECRET-1", testId, conceptId: "c1", questionId: "q1",
  selectedOption: "C", correctOption: "B", isCorrect: false, submittedAt: "2026-09-20T09:00:00Z", ...over,
});
const req = (testId = "t1", over: Partial<UpdateRequest> = {}): UpdateRequest => ({
  studentId: "stu-SECRET-1", concept, attempts: [attemptFor(testId, `att-SECRET-${testId}`)], questions: [q1], curriculum, ...over,
});

const A = "You chose x·cos(x), which suggests you differentiated only one factor.\n\nThe product rule says (fg)' = f'g + fg'. See [[Derivatives]].\n\nCheck yourself: what is d/dx of x²·eˣ?";
const B = "Revised: you chose x·cos(x), which treats the product like a single factor.\n\nThe product rule says (fg)' = f'g + fg'. See [[Chain Rule]] for composites.\n\nCheck: what is d/dx of x·ln(x)?";
const C = "Final: thanks for explaining. You believed each factor is differentiated separately, but both terms appear.\n\n(fg)' = f'g + fg'. Try d/dx of x·sin(x) again.";
const S2 = "Cycle two: this time you swapped the terms. Remember that the product rule has two terms added together, f'g and fg'.";
const BAD_LINK = "You chose x·cos(x), which suggests you differentiated only one factor. This connects to [[Quantum Gravity]] somehow.";

const DIAG = JSON.stringify({ errorType: "misconception", summary: "Differentiates only one factor.", suspectedMisconception: "Believes (fg)' = f·g'.", confidence: 0.8 });
const PASS = JSON.stringify({ verdict: "pass", objections: [] });
const revise = (message: string) => JSON.stringify({ verdict: "revise", objections: [{ kind: "inaccurate", message }] });
const clarify = (q: string) => JSON.stringify({ verdict: "needs_clarification", objections: [], clarifyingQuestion: q });

function fakeClock() {
  let t = 0;
  return () => new Date(Date.UTC(2026, 8, 20, 0, 0, t++));
}

function harness(script: Partial<Record<Task, Reply[]>>, config?: Partial<RunConfig>) {
  const r = routedLlm(script);
  const notes = createMemoryNoteStore({ clock: fakeClock() });
  const checkpoints = createMemoryCheckpointStore<NoteRunInput, string, string, string>();
  let ids = 0;
  let today = "2026-09-20";
  const make = (llm: typeof r.llm) =>
    createNoteUpdater({
      llm, notes, checkpoints,
      now: () => new Date(`${today}T10:00:00Z`),
      newId: () => `diag-${++ids}`,
      ...(config ? { config } : {}),
    });
  return { ...r, notes, checkpoints, updater: make(r.llm), make, setDate: (d: string) => { today = d; } };
}

function saved(r: NoteUpdateResult) {
  if (r.status !== "saved") throw new Error(`expected "saved", got ${JSON.stringify(r)}`);
  return r;
}
function asked(r: NoteUpdateResult) {
  if (r.status !== "needs_answer") throw new Error(`expected "needs_answer", got ${JSON.stringify(r)}`);
  return r;
}

// ---------- tests ----------
describe("first note", () => {
  it("diagnoses, writes, reviews, saves, and returns a contract-valid TailoredNote", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], review_section: [PASS] });
    const r = saved(await h.updater.update(req()));
    expect(r.provisional).toBe(false);
    expect(r.note).toMatchObject({
      id: "stu-SECRET-1:c1", studentId: "stu-SECRET-1", conceptId: "c1", version: 1,
      linkedConceptIds: ["c3"], basedOnDiagnosisIds: ["diag-1"],
    });
    expect(tailoredNoteValidator.validate(r.note).ok).toBe(true);
    expect(r.note.markdown.startsWith("# Product Rule\n\n## Update 1 · 2026-09-20\n\nYou chose x·cos(x)")).toBe(true);
    expect(r.note.markdown).toContain("<!-- synapse-run:t1 -->");
    expect((await h.notes.get("c1"))?.revision).toBe(1);
  });

  it("uses the fast tier to diagnose and the main tier for everything else", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], review_section: [PASS] });
    await h.updater.update(req());
    expect(h.calls.map((c) => [c.task, c.tier])).toEqual([["diagnose", "fast"], ["write_section", "main"], ["review_section", "main"]]);
  });

  it("never sends student, attempt or diagnosis ids to the model (full ask-and-answer run)", async () => {
    const h = harness(
      { diagnose: [DIAG], write_section: [A], revise_section: [B, C], review_section: [revise("m1"), revise("m2"), PASS], ask_student: ["Why C?"] },
      { maxRevisions: 1 },
    );
    const first = asked(await h.updater.update(req()));
    saved(await h.updater.answer(first.runId, "I thought each factor is differentiated separately"));
    const everything = h.allText();
    expect(everything.length).toBeGreaterThan(1000);
    expect(everything).not.toMatch(/SECRET|diag-/);
  });
});

describe("a later test on the same concept", () => {
  it("puts the new update on top, keeps every earlier word, and shows the model the older note as context", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A, B], review_section: [PASS] });
    const first = saved(await h.updater.update(req("t1")));
    h.setDate("2026-09-27");
    const second = saved(await h.updater.update(req("t2")));

    expect(second.note.version).toBe(2);
    const md = second.note.markdown;
    expect(md.indexOf("Update 2 · 2026-09-27")).toBeGreaterThan(-1);
    expect(md.indexOf("Update 2 · 2026-09-27")).toBeLessThan(md.indexOf("Update 1 · 2026-09-20"));
    expect(md).toContain("Revised: you chose");
    expect(md).toContain("You chose x·cos(x), which suggests");
    expect(md.match(/^# Product Rule$/gm)).toHaveLength(1);
    expect(isPreserved(first.note.markdown, md, "Product Rule")).toBe(true);
    expect(h.prompt("write_section", 1)).toContain("<previous_notes>");
    expect(h.prompt("write_section", 1)).toContain("Update 1 · 2026-09-20");
    expect(h.prompt("write_section", 1)).not.toContain("synapse-run");
    expect(h.allText()).not.toMatch(/SECRET|diag-/);

    const history = await h.notes.history("c1");
    expect(history.map((v) => v.revision)).toEqual([1, 2]);
    expect(history[0]?.markdown).toBe(first.note.markdown);
  });
});

describe("the review loop", () => {
  it("revises after an objection, then saves the revised section (not the first draft)", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], revise_section: [B], review_section: [revise("The formula is stated wrongly."), PASS] });
    const r = saved(await h.updater.update(req()));
    expect(r.note.markdown).toContain("Revised: you chose");
    expect(r.note.markdown).not.toContain("Check yourself: what is d/dx of x²·eˣ?");
    expect(h.prompt("revise_section")).toContain("- [inaccurate] The formula is stated wrongly.");
    expect(h.prompt("revise_section")).toContain("<current_section>");
  });

  it("catches a link to a concept outside the curriculum without paying for a review, then fixes it", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [BAD_LINK], revise_section: [A], review_section: [PASS] });
    const r = saved(await h.updater.update(req()));
    expect(h.count("review_section")).toBe(1);
    expect(h.prompt("revise_section")).toMatch(/\[links\].*\[\[Quantum Gravity\]\]/);
    expect(r.note.markdown).not.toContain("Quantum Gravity");
    expect(r.note.linkedConceptIds).toEqual(["c3"]);
  });
});

describe("asking the student", () => {
  it("out of revisions: the model writes a question, nothing is saved yet, the student answers, the note is saved", async () => {
    const h = harness(
      { diagnose: [DIAG], write_section: [A], revise_section: [B, C], review_section: [revise("m1"), revise("m2"), PASS], ask_student: ["  What did you picture happening to the second factor?  "] },
      { maxRevisions: 1 },
    );
    const q = asked(await h.updater.update(req()));
    expect(q.question).toBe("What did you picture happening to the second factor?");
    expect(await h.notes.list()).toEqual([]);
    expect(await h.updater.pending()).toEqual([{ runId: q.runId, conceptId: "c1", phase: "awaiting_human", question: q.question }]);

    const done = saved(await h.updater.answer(q.runId, "  I thought each factor is differentiated separately  "));
    expect(done.provisional).toBe(false);
    expect(done.note.markdown).toContain("Final: thanks for explaining");
    expect(h.prompt("revise_section", 1)).toContain("<student_answer>\nI thought each factor is differentiated separately\n</student_answer>");
    expect(h.prompt("review_section", 2)).toContain("I thought each factor is differentiated separately");
    expect(h.count("revise_section")).toBe(2);
    expect(await h.updater.pending()).toEqual([]);
    expect((await h.notes.history("c1"))).toHaveLength(1);
  });

  it("the reviewer can ask directly: its own question is used, and no second model call writes one", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], revise_section: [B], review_section: [clarify("Did you think each factor is differentiated separately?"), PASS] });
    const q = asked(await h.updater.update(req()));
    expect(q.question).toBe("Did you think each factor is differentiated separately?");
    expect(h.count("ask_student")).toBe(0);
    const done = saved(await h.updater.answer(q.runId, "Yes, that's what I did"));
    expect(done.note.markdown).toContain("Revised: you chose");
    expect(h.prompt("review_section", 1)).toContain("Yes, that's what I did");
  });

  it("updating again while a question is open just returns the same question, with no model calls", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], review_section: [clarify("Why C?")] });
    const q = asked(await h.updater.update(req()));
    const before = h.calls.length;
    expect(asked(await h.updater.update(req()))).toEqual(q);
    expect(h.calls.length).toBe(before);
  });

  it("rejects blank, oversized and misplaced answers without disturbing the run", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], revise_section: [B], review_section: [clarify("Why C?"), PASS] });
    const q = asked(await h.updater.update(req()));
    await expect(h.updater.answer(q.runId, "   ")).rejects.toThrow(/must not be blank/);
    await expect(h.updater.answer(q.runId, "x".repeat(2001))).rejects.toThrow(/too long/);
    await expect(h.updater.answer("nope", "hi")).rejects.toBeInstanceOf(RunNotFoundError);
    expect((await h.checkpoints.load(q.runId))?.phase).toBe("awaiting_human");
    saved(await h.updater.answer(q.runId, "fine"));
    await expect(h.updater.answer(q.runId, "again")).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it("survives a restart: a brand-new updater on the same stores lists the open question and finishes the run", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], review_section: [revise("m")], ask_student: ["Why C?"] }, { maxRevisions: 0 });
    const q = asked(await h.updater.update(req()));

    const later = routedLlm({ revise_section: [B], review_section: [PASS] });
    const restarted = h.make(later.llm);
    expect(await restarted.pending()).toEqual([{ runId: q.runId, conceptId: "c1", phase: "awaiting_human", question: "Why C?" }]);
    const done = saved(await restarted.answer(q.runId, "I mixed up the terms"));
    expect(done.note.markdown).toContain("Revised: you chose");
    expect(later.count("diagnose")).toBe(0);
    expect(later.count("write_section")).toBe(0);
  });
});

describe("giving up", () => {
  it("saves a clearly marked provisional note when nothing satisfies the reviewer and there's nobody to ask", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], review_section: [revise("still wrong")] }, { maxRevisions: 0, maxClarifications: 0 });
    const r = saved(await h.updater.update(req()));
    expect(r.provisional).toBe(true);
    expect(r.note.markdown).toContain("> **Provisional:** this update could not be fully checked.");
    expect(r.note.markdown).toContain("You chose x·cos(x), which suggests");
    expect(h.count("ask_student")).toBe(0);
  });
});

describe("failures", () => {
  it("a malformed diagnosis reply is repaired once", async () => {
    const h = harness({ diagnose: ["not json at all", DIAG], write_section: [A], review_section: [PASS] });
    saved(await h.updater.update(req()));
    expect(h.count("diagnose")).toBe(2);
  });

  it("a diagnosis that never validates fails the call and leaves nothing behind", async () => {
    const h = harness({ diagnose: ["nope"] });
    await expect(h.updater.update(req())).rejects.toBeInstanceOf(LlmOutputError);
    expect(await h.checkpoints.list()).toEqual([]);
    expect(await h.notes.list()).toEqual([]);
  });

  it("a model outage mid-run becomes a retryable failure; retry redoes only the failed step and saves once", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [new Error("NIM 503"), A], review_section: [PASS] });
    const failed = await h.updater.update(req());
    expect(failed).toMatchObject({ status: "failed", during: "drafting", message: "NIM 503" });
    expect(await h.notes.list()).toEqual([]);
    const again = await h.updater.update(req());
    expect(again).toEqual(failed);
    expect(h.count("write_section")).toBe(1);

    const done = saved(await h.updater.retry(failed.status === "failed" ? failed.runId : ""));
    expect(done.note.version).toBe(1);
    expect(h.count("write_section")).toBe(2);
    expect(h.count("diagnose")).toBe(1);
  });
});

describe("idempotency and interleaved tests", () => {
  it("calling update again after it finished changes nothing and calls no model", async () => {
    const h = harness({ diagnose: [DIAG], write_section: [A], review_section: [PASS] });
    const first = saved(await h.updater.update(req()));
    const calls = h.calls.length;
    const second = saved(await h.updater.update(req()));
    expect(second.note).toEqual(first.note);
    expect(h.calls.length).toBe(calls);
    expect(await h.notes.history("c1")).toHaveLength(1);
  });

  it("a question left open while a newer test finishes: the late answer lands on top, nothing is lost, and it never applies twice", async () => {
    const h = harness(
      { diagnose: [DIAG], write_section: [A, S2], revise_section: [B], review_section: [revise("m"), PASS, PASS], ask_student: ["Why C?"] },
      { maxRevisions: 0 },
    );
    const open = asked(await h.updater.update(req("t1")));

    h.setDate("2026-09-27");
    const newer = saved(await h.updater.update(req("t2")));
    expect(newer.note.version).toBe(1);

    const late = saved(await h.updater.answer(open.runId, "I mixed up the terms"));
    expect(late.note.version).toBe(2);
    const md = late.note.markdown;
    expect(md.indexOf("Revised: you chose")).toBeLessThan(md.indexOf("Cycle two: this time"));
    expect(md.indexOf("Update 2 · 2026-09-20")).toBeLessThan(md.indexOf("Update 1 · 2026-09-27"));
    expect(isPreserved(newer.note.markdown, md, "Product Rule")).toBe(true);

    const replay = saved(await h.updater.update(req("t1")));
    expect(replay.note.version).toBe(2);
    expect((await h.notes.get("c1"))?.revision).toBe(2);
    expect(md.match(/synapse-run:/g)).toHaveLength(2);
  });
});

describe("request validation", () => {
  it("only wrong answers create work: all-correct is a no-op with no model calls and no run", async () => {
    const h = harness({});
    const r = await h.updater.update(req("t1", { attempts: [attemptFor("t1", "a1", { isCorrect: true, selectedOption: "B" })] }));
    expect(r).toEqual({ status: "no_gaps" });
    expect(h.calls).toHaveLength(0);
    expect(await h.checkpoints.list()).toEqual([]);
  });

  it("refuses mixed students, tests or concepts, empty input, and missing question text", async () => {
    const h = harness({});
    await expect(h.updater.update(req("t1", { attempts: [] }))).rejects.toThrow(/no attempts/);
    await expect(h.updater.update(req("t1", { attempts: [attemptFor("t1", "a1"), attemptFor("t2", "a2")] }))).rejects.toThrow(/same test/);
    await expect(h.updater.update(req("t1", { attempts: [attemptFor("t1", "a1", { studentId: "someone-else" })] }))).rejects.toThrow(/different student/);
    await expect(h.updater.update(req("t1", { attempts: [attemptFor("t1", "a1", { conceptId: "c9" })] }))).rejects.toThrow(/different concept/);
    await expect(h.updater.update(req("t1", { questions: [] }))).rejects.toThrow(/no question text/);
    expect(h.calls).toHaveLength(0);
  });

  it("several wrong answers in one test are all diagnosed and all reach the writing prompt", async () => {
    const q2: QuestionContext = { questionId: "q2", stem: "Differentiate x²·eˣ", options: [{ id: "A", text: "2x·eˣ" }, { id: "B", text: "2x·eˣ + x²·eˣ" }] };
    const h = harness({ diagnose: [DIAG], write_section: [A], review_section: [PASS] });
    const r = saved(await h.updater.update(req("t1", {
      attempts: [attemptFor("t1", "a1"), attemptFor("t1", "a2", { questionId: "q2", selectedOption: "A", correctOption: "B" })],
      questions: [q1, q2],
    })));
    expect(h.count("diagnose")).toBe(2);
    expect(r.note.basedOnDiagnosisIds).toEqual(["diag-1", "diag-2"]);
    expect(h.prompt("write_section")).toContain("Differentiate x²·eˣ");
    expect(h.prompt("write_section")).toContain("The student chose: 2x·eˣ");
  });
});
