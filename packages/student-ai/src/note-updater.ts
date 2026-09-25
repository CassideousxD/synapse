import {
  createRunner,
  isActive,
  type CheckpointStore,
  type RunConfig,
  type RunState,
} from "@synapse/agent-runtime";
import type { Attempt, ConceptNode, TailoredNote } from "@synapse/contracts";
import tailoredNoteSchema from "@synapse/contracts/schemas/tailored-note.schema.json";
import type { LlmClient } from "@synapse/llm-client";
import { extractWikilinks, normalizeConceptName, type NoteStore } from "@synapse/note-store";
import { checkSection } from "./checks";
import { composeNote, isPreserved } from "./compose";
import { diagnoseAttempt } from "./diagnosis";
import type { Tier } from "./json";
import type { Mistake, NoteRunInput } from "./note-types";
import { createNoteSteps, type NoteStepName } from "./note-steps";
import type { QuestionContext } from "./types";
import { looksLikeReasoning, runMarker } from "./text";
import { createValidator } from "./validate";

export const tailoredNoteValidator = createValidator<TailoredNote>("TailoredNote", tailoredNoteSchema);

export const MAX_ANSWER_CHARS = 2000;
const PROVISIONAL_NOTICE = "> **Provisional:** this update could not be fully checked. Treat it with some care.";
const FALLBACK_NOTICE =
  "> **Provisional:** a full explanation could not be written this time, so this is an automatic summary of your mistake.";

export type NoteRunState = RunState<NoteRunInput, string, string, string>;

export interface UpdateRequest {
  studentId: string;
  concept: ConceptNode;
  /** This test's attempts on this concept. Correct ones are ignored. */
  attempts: Attempt[];
  /** The questions those attempts were about. */
  questions: QuestionContext[];
  /** The concepts a note may [[link]] to. */
  curriculum: ConceptNode[];
}

export type NoteUpdateResult =
  | { status: "no_gaps" }
  | { status: "needs_answer"; runId: string; question: string }
  | { status: "saved"; runId: string; provisional: boolean; fallback: boolean; note: TailoredNote }
  | { status: "failed"; runId: string; during: string; message: string };

export interface PendingRun {
  runId: string;
  conceptId: string;
  phase: string;
  question: string | null;
}

export interface NoteUpdater {
  /** Idempotent per (student, concept, test): calling it again resumes or replays the same run. */
  update(request: UpdateRequest): Promise<NoteUpdateResult>;
  /** Give the student's answer to a run that asked a question. */
  answer(runId: string, text: string): Promise<NoteUpdateResult>;
  /** Re-run the step that failed (e.g. after the network came back). */
  retry(runId: string): Promise<NoteUpdateResult>;
  /** Continue a run that was interrupted mid-step (e.g. the tab closed). */
  resume(runId: string): Promise<NoteUpdateResult>;
  /** Unfinished runs, for restoring the UI after a reload. Finished runs whose save didn't happen are recovered by calling update() again. */
  pending(): Promise<PendingRun[]>;
}

export interface NoteUpdaterDeps {
  llm: Pick<LlmClient, "chat">;
  notes: NoteStore;
  checkpoints: CheckpointStore<NoteRunInput, string, string, string>;
  /** diagnose defaults to "fast"; the note steps default to "main". */
  tiers?: Partial<Record<NoteStepName | "diagnose", Tier>>;
  config?: Partial<RunConfig>;
  maxRepairs?: number;
  now?: () => Date;
  newId?: () => string;
}

const optionText = (q: QuestionContext, id: string): string => q.options.find((o) => o.id === id)?.text ?? id;

/** A plain, deterministic summary from what we already know, for when no usable model-written section exists. */
function fallbackSection(mistakes: readonly Mistake[]): string {
  return mistakes
    .map((m) => {
      const lines = [
        `For the question "${m.question}" you chose **${m.chosen}**, but the correct answer is **${m.correct}**.`,
        "",
        `What probably happened: ${m.summary}`,
      ];
      if (m.suspectedMisconception !== null) lines.push("", `A belief that may be behind this: ${m.suspectedMisconception}`);
      return lines.join("\n");
    })
    .join("\n\n")
    .replace(/\[\[|\]\]/g, ""); // a link here could point outside the curriculum
}

function validateRequest(req: UpdateRequest): void {
  if (req.attempts.length === 0) throw new Error("update: no attempts were given");
  if (new Set(req.attempts.map((a) => a.testId)).size !== 1) {
    throw new Error("update: all attempts must come from the same test");
  }
  for (const a of req.attempts) {
    if (a.studentId !== req.studentId) throw new Error(`update: attempt ${a.id} belongs to a different student`);
    if (a.conceptId !== req.concept.id) throw new Error(`update: attempt ${a.id} belongs to a different concept`);
  }
}

export function createNoteUpdater(deps: NoteUpdaterDeps): NoteUpdater {
  const now = deps.now ?? (() => new Date());
  const { notes, checkpoints } = deps;

  const runner = createRunner<NoteRunInput, string, string, string>({
    steps: createNoteSteps({
      llm: deps.llm,
      ...(deps.tiers ? { tiers: deps.tiers } : {}),
      ...(deps.maxRepairs !== undefined ? { maxRepairs: deps.maxRepairs } : {}),
    }),
    checkpoints,
    ...(deps.config ? { config: deps.config } : {}),
  });

  /** Compose against the note as it is NOW, save, and describe the result. Safe to call more than once. */
  async function finalize(state: NoteRunState, provisional: boolean): Promise<NoteUpdateResult> {
    const input = state.input;
    if (state.draft === null) throw new Error(`Run ${state.runId} finished without a draft`);
    const marker = runMarker(input.cycleId);
    // A give-up can leave a draft that fails the hard checks (too long, cut off, the model's own reasoning). A note is the
    // student's own text, so never save that: use a plain summary built from the diagnoses instead. Checked for accepted
    // drafts too, as a last line of defence.
    const fallback = looksLikeReasoning(state.draft) || checkSection(state.draft, input.linkable).length > 0;
    const isProvisional = provisional || fallback;
    const section = fallback ? fallbackSection(input.mistakes) : state.draft;

    let saved = await notes.get(input.concept.id);
    if (saved === undefined || !saved.markdown.includes(marker)) {
      const notice = isProvisional ? (fallback ? FALLBACK_NOTICE : PROVISIONAL_NOTICE) : null;
      const body = [notice, section, marker].filter((p) => p !== null).join("\n\n");
      const markdown = composeNote({
        conceptName: input.concept.name,
        sectionBody: body,
        updateNumber: (saved?.revision ?? 0) + 1,
        date: input.date,
        ...(saved ? { previousMarkdown: saved.markdown } : {}),
      });
      if (saved && !isPreserved(saved.markdown, markdown, input.concept.name)) {
        throw new Error("Internal error: saving this update would have lost earlier note text");
      }
      saved = await notes.save({ conceptId: input.concept.id, title: input.concept.name, markdown });
    }

    const idByName = new Map(input.linkable.map((c) => [normalizeConceptName(c.name), c.id]));
    const linkedConceptIds = [
      ...new Set(
        extractWikilinks(saved.markdown)
          .map((l) => idByName.get(l.key))
          .filter((id): id is string => id !== undefined && id !== input.concept.id),
      ),
    ];
    const note = {
      id: `${input.studentId}:${input.concept.id}`,
      studentId: input.studentId,
      conceptId: input.concept.id,
      version: saved.revision,
      markdown: saved.markdown,
      linkedConceptIds,
      basedOnDiagnosisIds: input.mistakes.map((m) => m.diagnosisId),
      updatedAt: saved.updatedAt,
    };
    const checked = tailoredNoteValidator.validate(note);
    if (!checked.ok) throw new Error(`Internal error: assembled TailoredNote is invalid: ${checked.errors.join("; ")}`);
    return { status: "saved", runId: state.runId, provisional: isProvisional, fallback, note: checked.value };
  }

  async function settle(state: NoteRunState): Promise<NoteUpdateResult> {
    switch (state.phase) {
      case "accepted":
        return finalize(state, false);
      case "gave_up":
        return finalize(state, true);
      case "awaiting_human":
        return { status: "needs_answer", runId: state.runId, question: state.question ?? "" };
      case "failed":
        return {
          status: "failed",
          runId: state.runId,
          during: state.error?.during ?? "unknown",
          message: state.error?.message ?? "unknown error",
        };
      default:
        throw new Error(`Run ${state.runId} stopped in unexpected phase "${state.phase}"`);
    }
  }

  return {
    async update(req) {
      validateRequest(req);
      const wrong = req.attempts.filter((a) => !a.isCorrect);
      if (wrong.length === 0) return { status: "no_gaps" };

      const cycleId = req.attempts[0]!.testId;
      const runId = `${req.studentId}:${req.concept.id}:${cycleId}`;

      const existing = await runner.get(runId);
      if (existing) return settle(isActive(existing.phase) ? await runner.resume(runId) : existing);

      // Diagnose before starting the run, so a failure here leaves nothing behind.
      const mistakes: Mistake[] = [];
      for (const attempt of wrong) {
        const question = req.questions.find((q) => q.questionId === attempt.questionId);
        if (!question) throw new Error(`update: no question text was given for question ${attempt.questionId}`);
        const d = await diagnoseAttempt(
          {
            llm: deps.llm,
            ...(deps.tiers?.diagnose ? { tier: deps.tiers.diagnose } : {}),
            ...(deps.maxRepairs !== undefined ? { maxRepairs: deps.maxRepairs } : {}),
            now,
            ...(deps.newId ? { newId: deps.newId } : {}),
          },
          { attempt, question, concept: req.concept },
        );
        mistakes.push({
          diagnosisId: d.id,
          question: question.stem,
          chosen: optionText(question, attempt.selectedOption),
          correct: optionText(question, attempt.correctOption),
          errorType: d.errorType,
          summary: d.summary,
          suspectedMisconception: d.suspectedMisconception ?? null,
          confidence: d.confidence,
        });
      }

      const previous = await notes.get(req.concept.id);
      const input: NoteRunInput = {
        studentId: req.studentId,
        cycleId,
        concept: { id: req.concept.id, name: req.concept.name, summary: req.concept.summary },
        linkable: req.curriculum.map((c) => ({ id: c.id, name: c.name })),
        mistakes,
        previousMarkdown: previous?.markdown ?? null,
        date: now().toISOString().slice(0, 10),
      };
      return settle(await runner.start(runId, input));
    },

    async answer(runId, text) {
      const answer = text.trim();
      if (answer === "") throw new Error("The answer must not be blank");
      if (answer.length > MAX_ANSWER_CHARS) throw new Error(`The answer is too long (max ${MAX_ANSWER_CHARS} characters)`);
      return settle(await runner.answer(runId, answer));
    },

    retry: async (runId) => settle(await runner.retry(runId)),

    resume: async (runId) => settle(await runner.resume(runId)),

    async pending() {
      return (await checkpoints.list())
        .filter((s) => s.phase !== "accepted" && s.phase !== "gave_up")
        .map((s) => ({ runId: s.runId, conceptId: s.input.concept.id, phase: s.phase, question: s.question }));
    },
  };
}
