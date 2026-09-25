import { createMemoryCheckpointStore } from "@synapse/agent-runtime";
import type { Attempt, ConceptNode } from "@synapse/contracts";
import type { LlmClient } from "@synapse/llm-client";
import { createMemoryNoteStore, extractWikilinks, normalizeConceptName } from "@synapse/note-store";
import { checkSection } from "../src/checks";
import { isPreserved } from "../src/compose";
import type { NoteRunInput } from "../src/note-types";
import {
  createNoteUpdater,
  type NoteUpdater,
  type NoteUpdaterDeps,
  type NoteUpdateResult,
  type UpdateRequest,
} from "../src/note-updater";
import { looksLikeReasoning } from "../src/text";
import type { QuestionContext } from "../src/types";

/**
 * Live check of the whole note pipeline against a real model. Not a unit test: model output varies, so
 * "hard" checks (must hold) fail the run and "soft" checks (quality signals) only warn. The note itself is
 * printed for a human to read. The client is injected so the harness can be tested with a fake.
 */
export type Scenario = "a" | "b" | "c" | "d" | "e" | "f";
export const ALL_SCENARIOS: readonly Scenario[] = ["a", "b", "c", "d", "e", "f"];

type Chat = Pick<LlmClient, "chat">;
type ChatReq = Parameters<LlmClient["chat"]>[0];

export interface LiveOptions {
  scenarios: readonly Scenario[];
  log: (line: string) => void;
  /** Per-step model tiers, e.g. { review: "heavy" } to see if a stronger reviewer catches more. */
  tiers?: NoteUpdaterDeps["tiers"];
}
export interface Check {
  scenario: string;
  name: string;
  ok: boolean;
  soft: boolean;
  detail?: string;
}
export interface CallRecord {
  scenario: string;
  task: string;
  tier: string;
  model: string;
  ms: number;
  promptChars: number;
  replyChars: number;
  repair: boolean;
  injected: boolean;
  error?: string;
}
export interface LiveReport {
  ok: boolean;
  checks: Check[];
  calls: CallRecord[];
}

// ---------- fixture: one student, one concept ----------
const STUDENT = "stu-LIVE-7f3a";
const concept: ConceptNode = {
  id: "c-product-rule",
  name: "Product Rule",
  summary: "The derivative of a product of two functions f(x)g(x) is f'(x)g(x) + f(x)g'(x).",
};
const curriculum: ConceptNode[] = [
  concept,
  { id: "c-chain-rule", name: "Chain Rule", summary: "The derivative of a composite function f(g(x)) is f'(g(x))·g'(x)." },
  { id: "c-quotient-rule", name: "Quotient Rule", summary: "The derivative of f(x)/g(x) is (f'g - fg')/g²." },
  { id: "c-derivative-basics", name: "Derivative Basics", summary: "The derivative measures the instantaneous rate of change of a function." },
];
const q1: QuestionContext = {
  questionId: "q-live-1",
  stem: "What is d/dx of x·sin(x)?",
  options: [
    { id: "A", text: "cos(x)" },
    { id: "B", text: "sin(x) + x·cos(x)" },
    { id: "C", text: "x·cos(x)" },
    { id: "D", text: "sin(x)" },
  ],
};
const q2: QuestionContext = {
  questionId: "q-live-2",
  stem: "Differentiate x²·eˣ.",
  options: [
    { id: "A", text: "2x·eˣ" },
    { id: "B", text: "2x·eˣ + x²·eˣ" },
    { id: "C", text: "x²·eˣ" },
    { id: "D", text: "2x·x²·eˣ" },
  ],
};
const CANNED_QUESTION = "When you picked x·cos(x), what did you think happens to the sin(x) part of the product?";
// Consistent with the choice x·cos(x): only sin(x) was differentiated and the x was left alone.
const CANNED_ANSWER = "I thought you only differentiate the second part, sin(x), and just leave the first part, x, as it is.";
// Contradicts the choice: differentiating the FIRST part and leaving the second would give sin(x), not x·cos(x).
// Real students do this, and it once made the reviser write its reasoning into the note.
const CONTRADICTORY_ANSWER = "I thought you differentiate the first part and just leave the second part as it is.";
// A draft with a planted factual error (it states the product rule wrongly). A good reviewer must not pass it.
const BAD_SECTION =
  "You chose x·cos(x). The product rule says that the derivative of a product is the product of the derivatives, so (fg)' = f'g'. " +
  "Applying it here gives (x)'(sin x)' = 1·cos(x) = cos(x), so your answer x·cos(x) is close, but double check it.\n\n" +
  "Check yourself: what is d/dx of x·ln(x)?";
// A subtler plant: the maths is right, but it says the student MISSED the term they actually wrote (x·cos(x) is f·g').
// What they missed is f'·g = sin(x). Getting the student's mistake backwards is the failure a reviewer must catch.
const BAD_SECTION_2 =
  "You chose x·cos(x). The product rule says (fg)' = f'g + fg'. With f = x and g = sin(x) we get f' = 1 and g' = cos(x), " +
  "so the derivative is 1·sin(x) + x·cos(x) = sin(x) + x·cos(x). Your answer missed the second term, x·cos(x), so you should add it.\n\n" +
  "Check yourself: what is d/dx of x·ln(x)?";

const wrongAttempt = (testId: string, q: QuestionContext, selected: string, correct: string): Attempt => ({
  id: `att-LIVE-${testId}-${q.questionId}`,
  studentId: STUDENT,
  testId,
  conceptId: concept.id,
  questionId: q.questionId,
  selectedOption: selected,
  correctOption: correct,
  isCorrect: false,
  submittedAt: new Date().toISOString(),
});
const request = (attempts: Attempt[], questions: QuestionContext[]): UpdateRequest => ({
  studentId: STUDENT, concept, attempts, questions, curriculum,
});

// ---------- instrumentation ----------
function instrument(
  inner: Chat,
  scenario: string,
  records: CallRecord[],
  prompts: string[],
  log: (l: string) => void,
  inject: Map<string, string[]>,
): Chat {
  return {
    async chat(req: ChatReq) {
      const task = /^TASK: (\w+)/.exec(req.messages[0]?.content ?? "")?.[1] ?? "unknown";
      const promptText = req.messages.map((m) => m.content).join("\n");
      prompts.push(promptText);
      const repair = (req.messages.at(-1)?.content ?? "").startsWith("Your previous reply was not a valid");
      const base = { scenario, task, tier: req.tier, promptChars: promptText.length, repair };

      const canned = inject.get(task)?.shift();
      if (canned !== undefined) {
        records.push({ ...base, model: "injected", ms: 0, replyChars: canned.length, injected: true });
        log(`   <- ${task} (injected by the test, no model call)`);
        return { content: canned, model: "injected" };
      }

      log(`   -> ${task}${repair ? " (repair)" : ""} [${req.tier}] ...`);
      const t0 = performance.now();
      try {
        const res = await inner.chat(req);
        const ms = Math.round(performance.now() - t0);
        records.push({ ...base, model: res.model, ms, replyChars: res.content.length, injected: false });
        const usage = res.usage !== undefined ? ` usage=${JSON.stringify(res.usage)}` : "";
        // Did the model follow the <note_section>/<question> protocol? Visible per call so a live run answers it at a glance.
        const wantsTags = task === "write_section" || task === "revise_section" || task === "ask_student";
        const tags = wantsTags ? (/<(note_section|question)>/i.test(res.content) ? " tags=yes" : " tags=NO") : "";
        log(`   <- ${task} ${ms}ms, ${promptText.length} -> ${res.content.length} chars (${res.model})${tags}${usage}`);
        if (res.content.length > 2500) {
          const flat = res.content.replace(/\s+/g, " ");
          log(`   !  long reply (${res.content.length} chars). Starts: ${flat.slice(0, 200)} ... Ends: ${flat.slice(-200)}`);
        }
        return res;
      } catch (e) {
        const ms = Math.round(performance.now() - t0);
        const message = e instanceof Error ? e.message : String(e);
        records.push({ ...base, model: "-", ms, replyChars: 0, injected: false, error: message });
        log(`   x  ${task} failed after ${ms}ms: ${message}`);
        throw e;
      }
    },
  };
}

interface Ctx {
  name: string;
  log: (l: string) => void;
  check: (name: string, ok: boolean, detail?: string, soft?: boolean) => void;
  prompts: string[];
  records: CallRecord[];
  updater: NoteUpdater;
  notes: ReturnType<typeof createMemoryNoteStore>;
  count: (task: string) => number;
}

function makeCtx(
  inner: Chat,
  name: string,
  log: (l: string) => void,
  checks: Check[],
  allRecords: CallRecord[],
  inject: Map<string, string[]>,
  tiers: NoteUpdaterDeps["tiers"],
): Ctx {
  const records: CallRecord[] = [];
  const prompts: string[] = [];
  const chat = instrument(inner, name, records, prompts, log, inject);
  const notes = createMemoryNoteStore();
  const checkpoints = createMemoryCheckpointStore<NoteRunInput, string, string, string>();
  const updater = createNoteUpdater({ llm: chat, notes, checkpoints, ...(tiers ? { tiers } : {}) });
  const ctx: Ctx = {
    name, log, prompts, records, updater, notes,
    count: (task) => records.filter((r) => r.task === task).length,
    check(checkName, ok, detail, soft = false) {
      checks.push({ scenario: name, name: checkName, ok, soft, ...(detail !== undefined ? { detail } : {}) });
      log(`   ${ok ? "PASS" : soft ? "warn" : "FAIL"}  ${checkName}${detail !== undefined && !ok ? `: ${detail}` : ""}`);
    },
  };
  // Records are appended to the shared list as the scenario finishes (see runScenario).
  void allRecords;
  return ctx;
}

/** Answer any question the pipeline asks, and retry a failed step once (network hiccups happen). */
async function drive(ctx: Ctx, first: NoteUpdateResult): Promise<NoteUpdateResult> {
  let r = first;
  let answered = 0;
  let retried = 0;
  for (;;) {
    if (r.status === "needs_answer" && answered < 2) {
      ctx.log(`   ?  the student is asked: ${r.question}`);
      ctx.log(`   >  canned answer: ${CANNED_ANSWER}`);
      answered++;
      r = await ctx.updater.answer(r.runId, CANNED_ANSWER);
      continue;
    }
    if (r.status === "failed" && retried < 1) {
      retried++;
      ctx.log(`   !  step "${r.during}" failed (${r.message}); retrying once`);
      r = await ctx.updater.retry(r.runId);
      continue;
    }
    return r;
  }
}

function checkNote(ctx: Ctx, r: NoteUpdateResult, updateNumber: number, chosenText: string): string | null {
  if (r.status !== "saved") {
    ctx.check("ends with a saved note", false, r.status === "failed" ? `${r.during}: ${r.message}` : `status ${r.status}`);
    return null;
  }
  const md = r.note.markdown;
  ctx.check("ends with a saved note", true);
  if (r.provisional) {
    const detail = r.fallback ? "saved as provisional, using the automatic fallback summary" : "saved as provisional";
    ctx.check("the note is not provisional (reviewer was eventually satisfied)", false, detail, true);
  }

  ctx.check("has the expected structure", md.startsWith(`# ${concept.name}\n\n## Update ${updateNumber} · `));
  ctx.check("no reasoning tags leaked into the note", !/<\/?think>/i.test(md));
  const body = /## Update \d+ · [\d-]+\n\n([\s\S]*)/.exec(md)?.[1] ?? "";
  ctx.check("the section is prose, not JSON", !/^\s*[{[]/.test(body));
  ctx.check("the saved section passes the deterministic checks (length, links)", checkSection(body, curriculum.map((c) => ({ id: c.id, name: c.name }))).length === 0);
  ctx.check("no model reasoning leaked into the note", !looksLikeReasoning(body));
  ctx.check("no LaTeX (math is plain text)", !/\\\(|\\\[|\$\$|\\frac|\\cdot/.test(body), undefined, true);
  ctx.check("the model wrote no 'Update N' heading of its own", !/^#{1,6}[ \t]*Update\b/im.test(body), undefined, true);
  ctx.check("does not link to its own concept", !extractWikilinks(body).some((l) => l.key === normalizeConceptName(concept.name)), undefined, true);

  const known = new Set(curriculum.map((c) => normalizeConceptName(c.name)));
  const badLinks = extractWikilinks(md).filter((l) => !known.has(l.key)).map((l) => l.target);
  ctx.check("links only to curriculum concepts", badLinks.length === 0, badLinks.join(", "));

  const leaks = [STUDENT, "att-LIVE", ...r.note.basedOnDiagnosisIds].filter((s) => ctx.prompts.some((p) => p.includes(s)));
  ctx.check("no student, attempt or diagnosis ids in any prompt", leaks.length === 0, leaks.join(", "));

  const squashed = md.toLowerCase().replace(/\s+/g, "");
  ctx.check("mentions what the student actually picked", squashed.includes(chosenText.toLowerCase().replace(/\s+/g, "")), chosenText, true);
  const words = body.split(/\s+/).filter(Boolean).length;
  ctx.check("length is sensible (40 to 450 words in this update)", words >= 40 && words <= 450, `${words} words`, true);
  const repairs = ctx.records.filter((x) => x.repair).length;
  ctx.check("needed at most 2 JSON repairs", repairs <= 2, `${repairs} repairs`, true);
  return md;
}

// ---------- scenarios ----------
/** One retry of a failed step: the free API tier answers 503 "overloaded" now and then. */
async function retryFailed(ctx: Ctx, r: NoteUpdateResult): Promise<NoteUpdateResult> {
  if (r.status !== "failed") return r;
  ctx.log(`   !  step "${r.during}" failed (${r.message}); retrying once`);
  return ctx.updater.retry(r.runId);
}

async function scenarioA(ctx: Ctx): Promise<void> {
  const first = await ctx.updater.update(request([wrongAttempt("t1", q1, "C", "B")], [q1]));
  const done = await drive(ctx, first);
  const md = checkNote(ctx, done, 1, "x·cos(x)");
  if (md !== null) ctx.log(`\n${md}\n`);
}

async function scenarioB(ctx: Ctx): Promise<void> {
  const first = await retryFailed(ctx, await ctx.updater.update(request([wrongAttempt("t1", q1, "C", "B")], [q1])));
  if (first.status !== "needs_answer") {
    ctx.check("asks the injected clarifying question", false, `status was ${first.status}`);
    return;
  }
  ctx.check("asks the injected clarifying question", first.question === CANNED_QUESTION, first.question);
  ctx.check("reused the reviewer's question (no separate ask_student call)", ctx.count("ask_student") === 0);
  ctx.log(`   >  canned answer: ${CANNED_ANSWER}`);
  const after = await ctx.updater.answer(first.runId, CANNED_ANSWER);
  const done = await drive(ctx, after);
  ctx.check("the revise prompt contained the student's answer", ctx.prompts.some((p) => p.startsWith("TASK: revise_section") && p.includes(CANNED_ANSWER)));
  const md = checkNote(ctx, done, 1, "x·cos(x)");
  if (md !== null) ctx.log(`\n${md}\n`);
}

async function scenarioC(ctx: Ctx): Promise<void> {
  const one = await drive(ctx, await ctx.updater.update(request([wrongAttempt("t1", q1, "C", "B")], [q1])));
  const first = checkNote(ctx, one, 1, "x·cos(x)");
  ctx.log("   --  a second test arrives on the same concept  --");
  const two = await drive(ctx, await ctx.updater.update(request([wrongAttempt("t2", q2, "A", "B")], [q2])));
  if (first === null || two.status !== "saved") {
    ctx.check("second update saved", false, two.status === "failed" ? `${two.during}: ${two.message}` : `status ${two.status}`);
    return;
  }
  ctx.check("second update saved", true);
  const md = two.note.markdown;
  ctx.check("version is 2", two.note.version === 2, `version ${two.note.version}`);
  ctx.check("the first note's text is still there, unaltered", isPreserved(first, md, concept.name));
  ctx.check("the new update is on top", md.indexOf("## Update 2") !== -1 && md.indexOf("## Update 2") < md.indexOf("## Update 1"));
  ctx.check("both revisions are in the history", (await ctx.notes.history(concept.id)).length === 2);
  ctx.check("the model was shown the older note as context", ctx.prompts.some((p) => p.startsWith("TASK: write_section") && p.includes("<previous_notes>")), undefined, true);
  ctx.check("no ids in any prompt across both cycles", ![STUDENT, "att-LIVE"].some((s) => ctx.prompts.some((p) => p.includes(s))));
  ctx.log(`\n${md}\n`);
}

async function scenarioD(ctx: Ctx): Promise<void> {
  const first = await ctx.updater.update(request([wrongAttempt("t1", q1, "C", "B")], [q1]));
  const done = await drive(ctx, first);
  ctx.check("the reviewer objected to the planted error instead of passing it", ctx.count("revise_section") > 0, undefined, true);
  const md = checkNote(ctx, done, 1, "x·cos(x)");
  if (md !== null) {
    const squashed = md.replace(/[·*\s]/g, "").replace(/\u2032/g, "'");
    ctx.check("the final note states the correct product rule (f'g + fg')", squashed.includes("f'g+fg'"), undefined, true);
    ctx.log(`\n${md}\n`);
  }
}

async function scenarioE(ctx: Ctx): Promise<void> {
  const first = await retryFailed(ctx, await ctx.updater.update(request([wrongAttempt("t1", q1, "C", "B")], [q1])));
  const done = await drive(ctx, first);
  ctx.check("the reviewer objected to a note that misstates what the student got wrong", ctx.count("revise_section") > 0, undefined, true);
  const md = checkNote(ctx, done, 1, "x·cos(x)");
  if (md !== null) {
    ctx.check("the final note no longer says the student missed the second term", !/miss(ed|ing) the second term/i.test(md), undefined, true);
    ctx.log(`\n${md}\n`);
  }
}

/** A student whose answer contradicts their own choice. The pipeline must never save a bad note: a clean one, or a clean failure. */
async function scenarioF(ctx: Ctx): Promise<void> {
  const first = await retryFailed(ctx, await ctx.updater.update(request([wrongAttempt("t1", q1, "C", "B")], [q1])));
  if (first.status !== "needs_answer") {
    ctx.check("asks the injected clarifying question", false, `status was ${first.status}`);
    return;
  }
  ctx.log(`   >  contradictory answer: ${CONTRADICTORY_ANSWER}`);
  const done = await retryFailed(ctx, await ctx.updater.answer(first.runId, CONTRADICTORY_ANSWER));
  if (done.status === "saved") {
    const md = checkNote(ctx, done, 1, "x·cos(x)");
    if (md !== null) ctx.log(`\n${md}\n`);
    return;
  }
  ctx.check("nothing was saved unless it passed the checks", (await ctx.notes.list()).length === 0);
  ctx.check("the run produced a note", false, done.status === "failed" ? `${done.during}: ${done.message}` : `status ${done.status}`, true);
}

const SCENARIOS: Record<Scenario, { title: string; run: (ctx: Ctx) => Promise<void>; inject: () => Map<string, string[]> }> = {
  a: { title: "A: one wrong answer, real models end to end", run: scenarioA, inject: () => new Map() },
  b: {
    title: "B: a clarifying question (the first review is injected, everything else is real)",
    run: scenarioB,
    inject: () =>
      new Map([["review_section", [JSON.stringify({ verdict: "needs_clarification", objections: [], clarifyingQuestion: CANNED_QUESTION })]]]),
  },
  c: { title: "C: two tests on the same concept (history must be kept)", run: scenarioC, inject: () => new Map() },
  d: {
    title: "D: a planted factual error in the first draft (does the reviewer catch it?)",
    run: scenarioD,
    inject: () => new Map([["write_section", [BAD_SECTION]]]),
  },
  e: {
    title: "E: a subtle plant, right maths but the student's mistake described backwards",
    run: scenarioE,
    inject: () => new Map([["write_section", [BAD_SECTION_2]]]),
  },
  f: {
    title: "F: the student's answer contradicts their own choice (never save junk)",
    run: scenarioF,
    inject: () =>
      new Map([["review_section", [JSON.stringify({ verdict: "needs_clarification", objections: [], clarifyingQuestion: CANNED_QUESTION })]]]),
  },
};

// ---------- entry ----------
export async function runLive(client: Chat, opts: LiveOptions): Promise<LiveReport> {
  const checks: Check[] = [];
  const calls: CallRecord[] = [];
  const { log } = opts;
  const t0 = performance.now();

  for (const s of opts.scenarios) {
    const def = SCENARIOS[s];
    log(`\n== Scenario ${def.title}`);
    const ctx = makeCtx(client, s, log, checks, calls, def.inject(), opts.tiers);
    try {
      await def.run(ctx);
    } catch (e) {
      ctx.check("scenario ran without throwing", false, e instanceof Error ? `${e.name}: ${e.message}` : String(e));
    }
    calls.push(...ctx.records);
  }

  log("\n== Summary");
  const tasks = [...new Set(calls.map((c) => c.task))];
  for (const task of tasks) {
    const real = calls.filter((c) => c.task === task && !c.injected && c.error === undefined);
    const avg = real.length > 0 ? Math.round(real.reduce((n, c) => n + c.ms, 0) / real.length) : 0;
    const repairs = calls.filter((c) => c.task === task && c.repair).length;
    const errors = calls.filter((c) => c.task === task && c.error !== undefined).length;
    const injected = calls.filter((c) => c.task === task && c.injected).length;
    log(`   ${task.padEnd(16)} calls ${String(real.length).padStart(2)}  avg ${String(avg).padStart(6)}ms  repairs ${repairs}  errors ${errors}${injected > 0 ? `  injected ${injected}` : ""}`);
  }
  const models = [...new Set(calls.filter((c) => !c.injected && c.error === undefined).map((c) => `${c.tier}=${c.model}`))];
  log(`   models used: ${models.join(", ") || "(none)"}`);
  log(`   total time: ${((performance.now() - t0) / 1000).toFixed(1)}s`);

  const hardFails = checks.filter((c) => !c.ok && !c.soft);
  const warnings = checks.filter((c) => !c.ok && c.soft);
  for (const c of hardFails) log(`   FAIL [${c.scenario}] ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  for (const c of warnings) log(`   warn [${c.scenario}] ${c.name}${c.detail ? `: ${c.detail}` : ""}`);
  log(`\n${hardFails.length === 0 ? "RESULT: OK" : "RESULT: FAILED"} (${hardFails.length} failed, ${warnings.length} warnings, ${checks.filter((c) => c.ok).length} passed)`);
  return { ok: hardFails.length === 0, checks, calls };
}
