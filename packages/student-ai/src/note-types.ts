import type { Diagnosis } from "@synapse/contracts";

/** One wrong answer, flattened to what the writing prompts need (no ids except diagnosisId). */
export interface Mistake {
  diagnosisId: string;
  /** The question stem. */
  question: string;
  /** Text of the option the student chose. */
  chosen: string;
  /** Text of the correct option. */
  correct: string;
  errorType: Diagnosis["errorType"];
  summary: string;
  suspectedMisconception: string | null;
  confidence: number;
}

export interface LinkableConcept {
  id: string;
  name: string;
}

/** Everything the agent loop needs. Plain JSON: it is checkpointed together with the run. */
export interface NoteRunInput {
  /** Never shown to the model. Kept so a resumed run can finish without extra arguments. */
  studentId: string;
  /** The test this run belongs to. */
  cycleId: string;
  concept: { id: string; name: string; summary: string };
  /** Concepts the note may [[link]] to. Anything else gets flagged. */
  linkable: LinkableConcept[];
  mistakes: Mistake[];
  /** The stored note when the run started. Context for the model only: the final note is composed against whatever is stored at save time. */
  previousMarkdown: string | null;
  /** YYYY-MM-DD, used in the section heading. */
  date: string;
}
