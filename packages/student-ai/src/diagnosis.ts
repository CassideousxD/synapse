import type { Attempt, ConceptNode, Diagnosis } from "@synapse/contracts";
import diagnosisSchema from "@synapse/contracts/schemas/diagnosis.schema.json";
import type { LlmClient } from "@synapse/llm-client";
import { callJson, type ChatMessage, type Tier } from "./json";
import type { QuestionContext } from "./types";
import { createValidator, pickSchema, refine } from "./validate";

/** What the model may produce. Everything else on a Diagnosis (ids, timestamps) is set by code. */
export type DiagnosisDraft = Pick<Diagnosis, "errorType" | "summary" | "suspectedMisconception" | "confidence">;

const DRAFT_KEYS = ["errorType", "summary", "suspectedMisconception", "confidence"];

/** The full contract. Used on the assembled object, so a bug of ours can't leak an invalid Diagnosis. */
export const diagnosisValidator = createValidator<Diagnosis>("Diagnosis", diagnosisSchema);

export const diagnosisDraftValidator = refine(
  createValidator<DiagnosisDraft>("Diagnosis", pickSchema(diagnosisSchema, DRAFT_KEYS)),
  (d) => [
    ...(d.summary.trim() === "" ? ["summary must not be blank"] : []),
    ...(d.suspectedMisconception !== undefined && d.suspectedMisconception.trim() === ""
      ? ["suspectedMisconception must not be blank; leave it out if there isn't one"]
      : []),
  ],
);

export interface DiagnoseInput {
  attempt: Attempt;
  question: QuestionContext;
  concept: ConceptNode;
}

export interface DiagnoseDeps {
  llm: Pick<LlmClient, "chat">;
  /** Default "fast": this is a small classification, not writing. */
  tier?: Tier;
  maxRepairs?: number;
  now?: () => Date;
  newId?: () => string;
}

const SYSTEM = `TASK: diagnose
You analyse one wrong answer to a multiple-choice question, to work out WHY the student chose it.

Reply with ONE JSON object and nothing else:
{
  "errorType": "misconception" | "missing_prerequisite" | "careless" | "unknown",
  "summary": string,
  "suspectedMisconception": string,
  "confidence": number
}

- errorType "misconception": the student holds a specific wrong belief about the concept.
- errorType "missing_prerequisite": the student lacks an earlier idea this concept builds on.
- errorType "careless": the student probably knows it and slipped (misread, arithmetic, rushed).
- errorType "unknown": the chosen option gives no clear signal.
- summary: one or two sentences on what the student probably believes or is missing. Do not restate the question.
- suspectedMisconception: the specific wrong belief in one sentence. Leave this key out unless errorType is "misconception".
- confidence: a number from 0 to 1. Use a low number when the wrong option gives little signal.
Do not include any other keys.`;

const optionLabel = (q: QuestionContext, id: string): string => {
  const found = q.options.find((o) => o.id === id);
  return found ? `[${found.id}] ${found.text}` : id;
};

export function buildDiagnosisMessages({ attempt, question, concept }: DiagnoseInput): ChatMessage[] {
  const options = question.options.map((o) => `- [${o.id}] ${o.text}`).join("\n");
  const user = [
    `Concept: ${concept.name}`,
    `About the concept: ${concept.summary}`,
    "",
    `Question: ${question.stem}`,
    "Options:",
    options,
    "",
    `The student chose: ${optionLabel(question, attempt.selectedOption)}`,
    `The correct answer is: ${optionLabel(question, attempt.correctOption)}`,
  ].join("\n");
  return [
    { role: "system", content: SYSTEM },
    { role: "user", content: user },
  ];
}

/** Diagnose one wrong attempt. The prompt contains no student or attempt ids. */
export async function diagnoseAttempt(deps: DiagnoseDeps, input: DiagnoseInput): Promise<Diagnosis> {
  const { attempt, question, concept } = input;
  if (attempt.isCorrect) throw new Error("diagnoseAttempt: the attempt is correct, so there is nothing to diagnose");
  if (attempt.questionId !== question.questionId) {
    throw new Error(`diagnoseAttempt: attempt is for question ${attempt.questionId} but got question ${question.questionId}`);
  }
  if (attempt.conceptId !== concept.id) {
    throw new Error(`diagnoseAttempt: attempt is for concept ${attempt.conceptId} but got concept ${concept.id}`);
  }

  const draft = await callJson({
    llm: deps.llm,
    tier: deps.tier ?? "fast",
    messages: buildDiagnosisMessages(input),
    validator: diagnosisDraftValidator,
    maxTokens: 800,
    ...(deps.maxRepairs !== undefined ? { maxRepairs: deps.maxRepairs } : {}),
  });

  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? (() => crypto.randomUUID());
  const assembled = {
    id: newId(),
    attemptId: attempt.id,
    studentId: attempt.studentId,
    conceptId: attempt.conceptId,
    ...draft,
    createdAt: now().toISOString(),
  };
  const full = diagnosisValidator.validate(assembled);
  if (!full.ok) throw new Error(`Internal error: assembled Diagnosis is invalid: ${full.errors.join("; ")}`);
  return full.value;
}
