import { buildGraph, type NoteGraph } from "./graph";
import {
  assertValidInput,
  DuplicateTitleError,
  type NoteRevision,
  type NoteStore,
  type NoteStoreOptions,
  type SaveNoteInput,
  type StoredNote,
} from "./types";
import { normalizeConceptName } from "./wikilinks";

/** In-memory NoteStore. For tests and Node scripts. Same contract as the IndexedDB one. */
export function createMemoryNoteStore(opts: NoteStoreOptions = {}): NoteStore {
  const clock = opts.clock ?? (() => new Date());
  const notes = new Map<string, StoredNote>();
  const revisions = new Map<string, NoteRevision[]>();

  // structuredClone so callers can't mutate our state, same as IndexedDB's copy semantics.
  const copy = <T>(v: T): T => structuredClone(v);

  const holderOfTitle = (titleKey: string): StoredNote | undefined => {
    for (const n of notes.values()) {
      if (normalizeConceptName(n.title) === titleKey) return n;
    }
    return undefined;
  };

  return {
    async save(input: SaveNoteInput): Promise<StoredNote> {
      assertValidInput(input);
      const holder = holderOfTitle(normalizeConceptName(input.title));
      if (holder && holder.conceptId !== input.conceptId) {
        throw new DuplicateTitleError(input.title, holder.conceptId);
      }
      const current = notes.get(input.conceptId);
      if (current && current.title === input.title && current.markdown === input.markdown) {
        return copy(current);
      }
      const now = clock().toISOString();
      const revision = (current?.revision ?? 0) + 1;
      const next: StoredNote = {
        conceptId: input.conceptId,
        title: input.title,
        markdown: input.markdown,
        revision,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
      };
      notes.set(input.conceptId, next);
      const list = revisions.get(input.conceptId) ?? [];
      list.push({
        conceptId: input.conceptId,
        revision,
        title: input.title,
        markdown: input.markdown,
        savedAt: now,
      });
      revisions.set(input.conceptId, list);
      return copy(next);
    },

    async get(conceptId) {
      const n = notes.get(conceptId);
      return n ? copy(n) : undefined;
    },

    async getByTitle(title) {
      const n = holderOfTitle(normalizeConceptName(title));
      return n ? copy(n) : undefined;
    },

    async list() {
      return [...notes.values()]
        .sort((a, b) => (a.conceptId < b.conceptId ? -1 : a.conceptId > b.conceptId ? 1 : 0))
        .map(copy);
    },

    async history(conceptId) {
      return copy(revisions.get(conceptId) ?? []);
    },

    async graph(): Promise<NoteGraph> {
      return buildGraph([...notes.values()]);
    },

    close() {},
  };
}
