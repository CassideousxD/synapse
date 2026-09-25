import type { RunState } from "./types";

/** Where run state is saved after every transition. Implementations must copy on save/load. */
export interface CheckpointStore<I, D, Q, A> {
  load(runId: string): Promise<RunState<I, D, Q, A> | undefined>;
  save(state: RunState<I, D, Q, A>): Promise<void>;
  /** All known runs; callers filter (e.g. to find unfinished ones on app start). */
  list(): Promise<RunState<I, D, Q, A>[]>;
}

/** In-memory store. structuredClone mimics IndexedDB copy semantics. */
export function createMemoryCheckpointStore<I, D, Q, A>(): CheckpointStore<I, D, Q, A> {
  const runs = new Map<string, RunState<I, D, Q, A>>();
  return {
    async load(runId) {
      const s = runs.get(runId);
      return s ? structuredClone(s) : undefined;
    },
    async save(state) {
      runs.set(state.runId, structuredClone(state));
    },
    async list() {
      return [...runs.values()].map((s) => structuredClone(s));
    },
  };
}
