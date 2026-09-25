import type { NoteGraph } from "./graph";

export interface StoredNote {
  conceptId: string;
  title: string;
  markdown: string;
  /** 1 on first save, +1 on every save that changes something */
  revision: number;
  /** ISO 8601 */
  createdAt: string;
  /** ISO 8601 */
  updatedAt: string;
}

/** One immutable snapshot per revision. Append-only. */
export interface NoteRevision {
  conceptId: string;
  revision: number;
  title: string;
  markdown: string;
  /** ISO 8601 */
  savedAt: string;
}

export interface SaveNoteInput {
  conceptId: string;
  title: string;
  markdown: string;
}

export interface NoteStoreOptions {
  /** Injectable for deterministic tests. */
  clock?: () => Date;
}

export interface NoteStore {
  /** Create or update. No-op (same revision returned) if nothing changed. */
  save(input: SaveNoteInput): Promise<StoredNote>;
  get(conceptId: string): Promise<StoredNote | undefined>;
  /** Case/whitespace-insensitive. */
  getByTitle(title: string): Promise<StoredNote | undefined>;
  /** Ordered by conceptId. */
  list(): Promise<StoredNote[]>;
  /** Oldest -> newest. Empty array if the concept has no note. */
  history(conceptId: string): Promise<NoteRevision[]>;
  /** Derived from the current notes; never stored. */
  graph(): Promise<NoteGraph>;
  close(): void;
}

/** Another concept already owns this title (compared case/whitespace-insensitively). */
export class DuplicateTitleError extends Error {
  readonly title: string;
  readonly heldBy: string;
  constructor(title: string, heldBy: string) {
    super(`Title "${title}" is already used by concept ${heldBy}`);
    this.name = "DuplicateTitleError";
    this.title = title;
    this.heldBy = heldBy;
  }
}

export function assertValidInput(input: SaveNoteInput): void {
  if (input.conceptId.trim() === "") throw new Error("conceptId must not be blank");
  if (input.title.trim() === "") throw new Error("title must not be blank");
}
