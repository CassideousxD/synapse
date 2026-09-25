import type { Phase, RunConfig, RunEvent, RunState } from "./types";

const norm = (s: string) => s.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();

/** Default stuck detector: same set of objections (ignoring case/whitespace/order). Weak on paraphrases. */
export function sameObjections(a: readonly string[], b: readonly string[]): boolean {
  const sa = new Set(a.map(norm));
  const sb = new Set(b.map(norm));
  if (sa.size !== sb.size) return false;
  for (const x of sa) if (!sb.has(x)) return false;
  return true;
}

export const DEFAULT_CONFIG: RunConfig = {
  maxRevisions: 2,
  maxClarifications: 1,
  isStuck: sameObjections,
};

export function resolveConfig(partial: Partial<RunConfig> = {}): RunConfig {
  const c: RunConfig = { ...DEFAULT_CONFIG, ...partial };
  for (const k of ["maxRevisions", "maxClarifications"] as const) {
    if (!Number.isInteger(c[k]) || c[k] < 0) {
      throw new Error(`${k} must be a non-negative integer, got ${String(c[k])}`);
    }
  }
  return c;
}

export class InvalidTransitionError extends Error {
  readonly phase: Phase;
  readonly eventType: string;
  constructor(phase: Phase, eventType: string) {
    super(`Event "${eventType}" is not valid in phase "${phase}"`);
    this.name = "InvalidTransitionError";
    this.phase = phase;
    this.eventType = eventType;
  }
}

/** Phases where the runner has a step to execute. */
export const isActive = (p: Phase): boolean =>
  p === "drafting" || p === "reviewing" || p === "revising" || p === "asking";

/** Phases that are final (failed is NOT final: retry() can revive it). */
export const isFinished = (p: Phase): boolean => p === "accepted" || p === "gave_up";

export function initialState<I, D, Q, A>(runId: string, input: I): RunState<I, D, Q, A> {
  return {
    runId,
    phase: "drafting",
    input,
    draft: null,
    objections: [],
    revisionsUsed: 0,
    roundReviews: 0,
    clarifications: [],
    question: null,
    stopReason: null,
    suggestedQuestion: null,
    error: null,
    trace: [],
  };
}

function assertNever(x: never): never {
  throw new Error(`Unhandled event: ${JSON.stringify(x)}`);
}

/** Pure. Never mutates `state`. Throws InvalidTransitionError for events that don't fit the phase. */
export function reduce<I, D, Q, A>(
  state: RunState<I, D, Q, A>,
  event: RunEvent<D, Q, A>,
  config: RunConfig,
): RunState<I, D, Q, A> {
  const need = (...allowed: Phase[]) => {
    if (!allowed.includes(state.phase)) throw new InvalidTransitionError(state.phase, event.type);
  };
  const log = (name: string) => [...state.trace, name];

  switch (event.type) {
    case "drafted": {
      need("drafting");
      return { ...state, phase: "reviewing", draft: event.draft, trace: log("drafted") };
    }

    case "reviewed": {
      need("reviewing");
      if (event.accepted) {
        return { ...state, phase: "accepted", objections: [], trace: log("reviewed:accepted") };
      }
      const canAsk = state.clarifications.length < config.maxClarifications;
      const next = {
        ...state,
        objections: event.objections,
        roundReviews: state.roundReviews + 1,
        trace: log("reviewed:rejected"),
      };
      if (event.needsClarification === true) {
        // The reviewer says this can't be fixed without the student: ask now, or give up if we're out of questions.
        return canAsk
          ? { ...next, phase: "asking", stopReason: "reviewer", suggestedQuestion: event.clarifyingQuestion ?? null }
          : { ...next, phase: "gave_up", stopReason: "reviewer" };
      }
      const stuck = state.roundReviews > 0 && config.isStuck(state.objections, event.objections);
      const exhausted = state.revisionsUsed >= config.maxRevisions;
      if (!stuck && !exhausted) return { ...next, phase: "revising" };
      return { ...next, stopReason: stuck ? "stuck" : "budget", phase: canAsk ? "asking" : "gave_up" };
    }

    case "revised": {
      need("revising");
      return {
        ...state,
        phase: "reviewing",
        draft: event.draft,
        revisionsUsed: state.revisionsUsed + 1,
        trace: log("revised"),
      };
    }

    case "question_posed": {
      need("asking");
      return {
        ...state,
        phase: "awaiting_human",
        question: event.question,
        suggestedQuestion: null,
        trace: log("question_posed"),
      };
    }

    case "answered": {
      need("awaiting_human");
      if (state.question === null) throw new Error("awaiting_human without a question (corrupt checkpoint)");
      return {
        ...state,
        phase: "revising",
        clarifications: [...state.clarifications, { question: state.question, answer: event.answer }],
        question: null,
        stopReason: null,
        suggestedQuestion: null,
        revisionsUsed: 0,
        roundReviews: 0,
        trace: log("answered"),
      };
    }

    case "step_failed": {
      need("drafting", "reviewing", "revising", "asking");
      return {
        ...state,
        phase: "failed",
        error: { message: event.message, during: state.phase },
        trace: log("step_failed"),
      };
    }

    case "retried": {
      need("failed");
      if (state.error === null) throw new Error("failed without an error (corrupt checkpoint)");
      return { ...state, phase: state.error.during, error: null, trace: log("retried") };
    }

    default:
      return assertNever(event);
  }
}
