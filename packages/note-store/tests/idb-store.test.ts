import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { openIndexedDbNoteStore } from "../src/idb-store";
import type { NoteStore } from "../src/types";
import { describeNoteStoreContract, fakeClock } from "./note-store.contract";

const opened: NoteStore[] = [];
const uniqueName = () => `test-${crypto.randomUUID()}`;

afterEach(() => {
  while (opened.length) opened.pop()?.close();
});

async function open(name: string, clock: () => Date) {
  const s = await openIndexedDbNoteStore(name, { clock });
  opened.push(s);
  return s;
}

describeNoteStoreContract("indexeddb", (clock) => open(uniqueName(), clock));

describe("IndexedDB persistence", () => {
  it("notes and history survive closing and reopening the database", async () => {
    const name = uniqueName();
    const clock = fakeClock();
    const s1 = await open(name, clock);
    await s1.save({ conceptId: "c1", title: "Chain Rule", markdown: "v1" });
    await s1.save({ conceptId: "c1", title: "Chain Rule", markdown: "v2" });
    s1.close();

    const s2 = await open(name, clock);
    expect((await s2.get("c1"))?.revision).toBe(2);
    expect((await s2.history("c1")).map((r) => r.markdown)).toEqual(["v1", "v2"]);
  });

  it("the unique title index is a real backstop (raw write bypassing save())", async () => {
    const name = uniqueName();
    const s = await open(name, fakeClock());
    await s.save({ conceptId: "c1", title: "Chain Rule", markdown: "x" });
    s.close();
    const { openDB } = await import("idb");
    const raw = await openDB(name, 1);
    await expect(
      raw.put("notes", { conceptId: "c2", title: "chain rule", markdown: "", revision: 1,
        createdAt: "", updatedAt: "", titleKey: "chain rule" }),
    ).rejects.toMatchObject({ name: "ConstraintError" });
    raw.close();
  });
});
