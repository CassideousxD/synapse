import { openDB, type DBSchema } from "idb";
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

/** The notes row also carries the normalized title, so a unique index can enforce title uniqueness. */
type NoteRow = StoredNote & { titleKey: string };

interface SynapseNotesDB extends DBSchema {
  notes: {
    key: string;
    value: NoteRow;
    indexes: { titleKey: string };
  };
  revisions: {
    key: [string, number];
    value: NoteRevision;
    indexes: { conceptId: string };
  };
}

const DB_VERSION = 1;

const toPublic = (row: NoteRow): StoredNote => {
  const { titleKey: _titleKey, ...note } = row;
  return note;
};

/** IndexedDB-backed NoteStore. Needs a global `indexedDB` (browser, worker, or fake-indexeddb in tests). */
export async function openIndexedDbNoteStore(
  dbName = "synapse-notes",
  opts: NoteStoreOptions = {},
): Promise<NoteStore> {
  const clock = opts.clock ?? (() => new Date());

  const db = await openDB<SynapseNotesDB>(dbName, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const notes = db.createObjectStore("notes", { keyPath: "conceptId" });
        notes.createIndex("titleKey", "titleKey", { unique: true }); // backstop; save() checks first
        const revs = db.createObjectStore("revisions", { keyPath: ["conceptId", "revision"] });
        revs.createIndex("conceptId", "conceptId");
      }
      // Future migrations: if (oldVersion < 2) { ... }
    },
  });

  return {
    async save(input: SaveNoteInput): Promise<StoredNote> {
      assertValidInput(input);
      const titleKey = normalizeConceptName(input.title);

      // One transaction over both stores => notes and revisions can't disagree.
      // Rule: between here and the puts, only await IndexedDB calls, or the tx auto-commits.
      const tx = db.transaction(["notes", "revisions"], "readwrite");
      const notes = tx.objectStore("notes");
      const revs = tx.objectStore("revisions");

      const holder = await notes.index("titleKey").get(titleKey);
      if (holder && holder.conceptId !== input.conceptId) {
        throw new DuplicateTitleError(input.title, holder.conceptId); // nothing written
      }

      const current = await notes.get(input.conceptId);
      if (current && current.title === input.title && current.markdown === input.markdown) {
        return toPublic(current);
      }

      const now = clock().toISOString();
      const revision = (current?.revision ?? 0) + 1;
      const row: NoteRow = {
        conceptId: input.conceptId,
        title: input.title,
        markdown: input.markdown,
        revision,
        createdAt: current?.createdAt ?? now,
        updatedAt: now,
        titleKey,
      };
      // Awaiting tx.done in the same Promise.all avoids an unhandled rejection if a put fails.
      await Promise.all([
        notes.put(row),
        revs.put({
          conceptId: input.conceptId,
          revision,
          title: input.title,
          markdown: input.markdown,
          savedAt: now,
        }),
        tx.done,
      ]);
      return toPublic(row);
    },

    async get(conceptId) {
      const row = await db.get("notes", conceptId);
      return row ? toPublic(row) : undefined;
    },

    async getByTitle(title) {
      const row = await db.getFromIndex("notes", "titleKey", normalizeConceptName(title));
      return row ? toPublic(row) : undefined;
    },

    async list() {
      return (await db.getAll("notes")).map(toPublic); // primary-key order = conceptId order
    },

    async history(conceptId) {
      // Same index key => ordered by primary key [conceptId, revision] => oldest first.
      return db.getAllFromIndex("revisions", "conceptId", conceptId);
    },

    async graph(): Promise<NoteGraph> {
      return buildGraph((await db.getAll("notes")).map(toPublic));
    },

    close() {
      db.close();
    },
  };
}
