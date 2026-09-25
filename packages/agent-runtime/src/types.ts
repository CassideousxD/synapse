export type Phase =
  | "drafting" // need a first draft
  | "reviewing" // have a draft, need a verdict
  | "revising" // have objections (and maybe human answers), need a better draft
  | "asking" // not converging: need a clarifying question to show the human
  | "awaiting_human" // PAUSED. Waiting for answer(). Stable checkpoint.
  | "accepted" // done: reviewer accepted
  | "gave_up" // done: still not accepted after all clarifications; draft is best effort
  | "failed"; // a step threw; retry() resumes from error.during

/** Why we stopped revising and moved to asking/gave_up. */
export type StopReason = "stuck" | "budget" | "reviewer";

export interface Clarification<Q, A> {
  question: Q;
  answer: A;
}

/** Everything here must stay plain JSON (it gets checkpointed). Use null, not undefined. */
export interface RunState<I, D, Q, A> {
  runId: string;
  phase: Phase;
  input: I;
  draft: D | null;
  /** Objections from the latest rejected review. */
  objections: string[];
  /** Revisions since the run started or since the last human answer. */
  revisionsUsed: number;
  /** Rejected reviews in the current round (used so "stuck" never fires on the first review of a round). */
  roundReviews: number;
  clarifications: Clarification<Q, A>[];
  /** Set only while phase === "awaiting_human". */
  question: Q | null;
  stopReason: StopReason | null;
  /** The reviewer's own proposed question, when it asked for clarification. Cleared once posed. */
  suggestedQuestion: string | null;
  error: { message: string; during: Phase } | null;
  /** Event names in order, for tests, debugging, and UI timelines. */
  trace: string[];
}

export type RunEvent<D, Q, A> =
  | { type: "drafted"; draft: D }
  | {
      type: "reviewed";
      accepted: boolean;
      objections: string[];
      /** Reviewer says this can't be fixed without the student's input. */
      needsClarification?: boolean;
      clarifyingQuestion?: string;
    }
  | { type: "revised"; draft: D }
  | { type: "question_posed"; question: Q }
  | { type: "answered"; answer: A }
  | { type: "step_failed"; message: string }
  | { type: "retried" };

export interface RunConfig {
  /** Max revise->review cycles per round before we stop and ask (or give up). */
  maxRevisions: number;
  /** How many times we may pause to ask the human. */
  maxClarifications: number;
  /** Pure. True if `current` is "the same problems again" as `previous`. */
  isStuck: (previous: readonly string[], current: readonly string[]) => boolean;
}

export interface ReviewOutcome {
  accepted: boolean;
  /** Required (non-empty) when accepted is false, unless needsClarification is true. */
  objections: string[];
  /** The reviewer can't be satisfied without asking the student: skip revising and ask now. */
  needsClarification?: boolean;
  /** The reviewer's own wording for that question; handed to ask() as suggestedQuestion. */
  clarifyingQuestion?: string;
}

/** What the caller plugs in. The runtime never talks to an LLM itself. */
export interface Steps<I, D, Q, A> {
  draft(args: { input: I }): Promise<D>;
  review(args: { input: I; draft: D; clarifications: Clarification<Q, A>[] }): Promise<ReviewOutcome>;
  revise(args: {
    input: I;
    draft: D;
    objections: string[];
    clarifications: Clarification<Q, A>[];
  }): Promise<D>;
  /** Turn "we're not converging" into a question for the human. */
  ask(args: {
    input: I;
    draft: D;
    objections: string[];
    clarifications: Clarification<Q, A>[];
    stopReason: StopReason;
    suggestedQuestion: string | null;
  }): Promise<Q>;
}
