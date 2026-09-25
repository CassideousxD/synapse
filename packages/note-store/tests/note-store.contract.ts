import { describe, expect, it } from "vitest";
import { DuplicateTitleError, type NoteStore } from "../src/types";
import { unresolvedId } from "../src/graph";

/** Deterministic clock: each call advances one second. */
export function fakeClock() {
  let t = 0;
  return () => new Date(Date.UTC(2026, 8, 20, 0, 0, t++));
}

/**
 * The behaviour every NoteStore must have. Run it against each implementation
 * so the in-memory fake can never drift from the real IndexedDB one.
 */
export function describeNoteStoreContract(
  name: string,
  make: (clock: () => Date) => Promise<NoteStore>,
) {
  describe(`NoteStore contract: ${name}`, () => {
    it("get returns undefined for a missing note; history is empty", async () => {
      const s = await make(fakeClock());
      expect(await s.get("nope")).toBeUndefined();
      expect(await s.history("nope")).toEqual([]);
    });

    it("first save is revision 1 with matching timestamps", async () => {
      const s = await make(fakeClock());
      const n = await s.save({ conceptId: "c1", title: "Chain Rule", markdown: "v1" });
      expect(n).toMatchObject({ conceptId: "c1", title: "Chain Rule", markdown: "v1", revision: 1 });
      expect(n.createdAt).toBe(n.updatedAt);
      expect(await s.get("c1")).toEqual(n);
    });

    it("a changed save bumps the revision, keeps createdAt, and keeps the old text in history", async () => {
      const s = await make(fakeClock());
      const a = await s.save({ conceptId: "c1", title: "Chain Rule", markdown: "my wrong idea" });
      const b = await s.save({ conceptId: "c1", title: "Chain Rule", markdown: "wrong idea\n\nnow I get it" });
      expect(b.revision).toBe(2);
      expect(b.createdAt).toBe(a.createdAt);
      expect(b.updatedAt > a.updatedAt).toBe(true);
      const h = await s.history("c1");
      expect(h.map((r) => r.revision)).toEqual([1, 2]);
      expect(h[0]?.markdown).toBe("my wrong idea");
      expect(h[1]?.markdown).toBe("wrong idea\n\nnow I get it");
    });

    it("saving identical content is a no-op", async () => {
      const s = await make(fakeClock());
      const a = await s.save({ conceptId: "c1", title: "T", markdown: "same" });
      const b = await s.save({ conceptId: "c1", title: "T", markdown: "same" });
      expect(b).toEqual(a);
      expect(await s.history("c1")).toHaveLength(1);
    });

    it("getByTitle ignores case and whitespace", async () => {
      const s = await make(fakeClock());
      await s.save({ conceptId: "c1", title: "Chain Rule", markdown: "x" });
      expect((await s.getByTitle("  chain   RULE "))?.conceptId).toBe("c1");
      expect(await s.getByTitle("Other")).toBeUndefined();
    });

    it("rejects a title owned by another concept, and writes nothing", async () => {
      const s = await make(fakeClock());
      await s.save({ conceptId: "c1", title: "Chain Rule", markdown: "x" });
      await expect(
        s.save({ conceptId: "c2", title: " chain rule ", markdown: "y" }),
      ).rejects.toBeInstanceOf(DuplicateTitleError);
      expect(await s.get("c2")).toBeUndefined();
      expect(await s.history("c2")).toEqual([]);
    });

    it("renaming frees the old title for someone else", async () => {
      const s = await make(fakeClock());
      await s.save({ conceptId: "c1", title: "X", markdown: "a" });
      await s.save({ conceptId: "c1", title: "Y", markdown: "a" });
      await s.save({ conceptId: "c2", title: "X", markdown: "b" });
      expect((await s.getByTitle("x"))?.conceptId).toBe("c2");
      expect((await s.getByTitle("y"))?.conceptId).toBe("c1");
    });

    it("rejects blank ids and titles", async () => {
      const s = await make(fakeClock());
      await expect(s.save({ conceptId: " ", title: "T", markdown: "" })).rejects.toThrow(/conceptId/);
      await expect(s.save({ conceptId: "c1", title: "  ", markdown: "" })).rejects.toThrow(/title/);
    });

    it("list is ordered by conceptId", async () => {
      const s = await make(fakeClock());
      await s.save({ conceptId: "b", title: "B", markdown: "" });
      await s.save({ conceptId: "a", title: "A", markdown: "" });
      await s.save({ conceptId: "c", title: "C", markdown: "" });
      expect((await s.list()).map((n) => n.conceptId)).toEqual(["a", "b", "c"]);
    });

    it("returns copies: mutating a result doesn't change the store", async () => {
      const s = await make(fakeClock());
      await s.save({ conceptId: "c1", title: "T", markdown: "orig" });
      const n = await s.get("c1");
      n!.markdown = "hacked";
      expect((await s.get("c1"))?.markdown).toBe("orig");
    });

    it("graph() is derived from stored notes, with ghost nodes", async () => {
      const s = await make(fakeClock());
      await s.save({ conceptId: "c1", title: "Chain Rule", markdown: "needs [[Derivatives]] and [[Limits]]" });
      await s.save({ conceptId: "c2", title: "Derivatives", markdown: "see [[Chain Rule]]" });
      const g = await s.graph();
      expect(g.edges).toContainEqual({ from: "c1", to: "c2" });
      expect(g.edges).toContainEqual({ from: "c2", to: "c1" });
      expect(g.nodes.find((n) => n.id === unresolvedId("limits"))?.exists).toBe(false);
    });
  });
}
