import type { CheckpointStore } from "./checkpoints";
import { initialState, InvalidTransitionError, isActive, reduce, resolveConfig } from "./machine";
import type { RunConfig, RunEvent, RunState, Steps } from "./types";

export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No run with id "${runId}"`);
    this.name = "RunNotFoundError";
  }
}
export class RunAlreadyExistsError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" already exists; use resume()`);
    this.name = "RunAlreadyExistsError";
  }
}
export class RunBusyError extends Error {
  constructor(runId: string) {
    super(`Run "${runId}" is already executing`);
    this.name = "RunBusyError";
  }
}

export interface RunnerDeps<I, D, Q, A> {
  steps: Steps<I, D, Q, A>;
  checkpoints: CheckpointStore<I, D, Q, A>;
  config?: Partial<RunConfig>;
  /** Called after every saved transition (e.g. to postMessage progress to the UI). Errors are ignored. */
  onCheckpoint?: (state: RunState<I, D, Q, A>) => void;
}

export interface Runner<I, D, Q, A> {
  /** Create a run and execute until it pauses (awaiting_human), finishes, or fails. */
  start(runId: string, input: I): Promise<RunState<I, D, Q, A>>;
  /** Continue from the last checkpoint (e.g. after a reload). Does nothing if paused/finished/failed. */
  resume(runId: string): Promise<RunState<I, D, Q, A>>;
  /** Give the human's answer to a paused run and continue. */
  answer(runId: string, answer: A): Promise<RunState<I, D, Q, A>>;
  /** Re-run the step of a failed run. */
  retry(runId: string): Promise<RunState<I, D, Q, A>>;
  get(runId: string): Promise<RunState<I, D, Q, A> | undefined>;
}

export function createRunner<I, D, Q, A>(deps: RunnerDeps<I, D, Q, A>): Runner<I, D, Q, A> {
  const { steps, checkpoints } = deps;
  const config = resolveConfig(deps.config);
  const busy = new Set<string>();

  async function exclusive<T>(runId: string, fn: () => Promise<T>): Promise<T> {
    if (busy.has(runId)) throw new RunBusyError(runId);
    busy.add(runId);
    try {
      return await fn();
    } finally {
      busy.delete(runId);
    }
  }

  async function load(runId: string): Promise<RunState<I, D, Q, A>> {
    const s = await checkpoints.load(runId);
    if (!s) throw new RunNotFoundError(runId);
    return s;
  }

  async function persist(s: RunState<I, D, Q, A>): Promise<void> {
    await checkpoints.save(s);
    try {
      deps.onCheckpoint?.(s);
    } catch {
      // Observers must never be able to break a run.
    }
  }

  function requireDraft(s: RunState<I, D, Q, A>): D {
    if (s.draft === null) throw new Error(`Phase "${s.phase}" without a draft (corrupt checkpoint)`);
    return s.draft;
  }

  async function execute(s: RunState<I, D, Q, A>): Promise<RunEvent<D, Q, A>> {
    switch (s.phase) {
      case "drafting":
        return { type: "drafted", draft: await steps.draft({ input: s.input }) };
      case "reviewing": {
        const r = await steps.review({
          input: s.input,
          draft: requireDraft(s),
          clarifications: s.clarifications,
        });
        if (!r.accepted && r.objections.length === 0 && r.needsClarification !== true) {
          throw new Error("Reviewer rejected the draft without giving any objections");
        }
        return {
          type: "reviewed",
          accepted: r.accepted,
          objections: r.objections,
          ...(r.needsClarification !== undefined ? { needsClarification: r.needsClarification } : {}),
          ...(r.clarifyingQuestion !== undefined ? { clarifyingQuestion: r.clarifyingQuestion } : {}),
        };
      }
      case "revising":
        return {
          type: "revised",
          draft: await steps.revise({
            input: s.input,
            draft: requireDraft(s),
            objections: s.objections,
            clarifications: s.clarifications,
          }),
        };
      case "asking": {
        if (s.stopReason === null) throw new Error('Phase "asking" without a stopReason (corrupt checkpoint)');
        return {
          type: "question_posed",
          question: await steps.ask({
            input: s.input,
            draft: requireDraft(s),
            objections: s.objections,
            clarifications: s.clarifications,
            stopReason: s.stopReason,
            suggestedQuestion: s.suggestedQuestion,
          }),
        };
      }
      default:
        throw new InvalidTransitionError(s.phase, "execute");
    }
  }

  async function runLoop(start: RunState<I, D, Q, A>): Promise<RunState<I, D, Q, A>> {
    let s = start;
    while (isActive(s.phase)) {
      let event: RunEvent<D, Q, A>;
      try {
        event = await execute(s);
      } catch (err) {
        event = { type: "step_failed", message: err instanceof Error ? err.message : String(err) };
      }
      s = reduce(s, event, config);
      await persist(s);
    }
    return s;
  }

  return {
    start: (runId, input) =>
      exclusive(runId, async () => {
        if (await checkpoints.load(runId)) throw new RunAlreadyExistsError(runId);
        const s = initialState<I, D, Q, A>(runId, input);
        await persist(s); // so a crash during the very first step is resumable
        return runLoop(s);
      }),

    resume: (runId) => exclusive(runId, async () => runLoop(await load(runId))),

    answer: (runId, answer) =>
      exclusive(runId, async () => {
        const s = reduce(await load(runId), { type: "answered", answer }, config);
        await persist(s);
        return runLoop(s);
      }),

    retry: (runId) =>
      exclusive(runId, async () => {
        const s = reduce(await load(runId), { type: "retried" }, config);
        await persist(s);
        return runLoop(s);
      }),

    get: (runId) => checkpoints.load(runId),
  };
}
