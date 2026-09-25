import { createMemoryNoteStore } from "../src/memory-store";
import { describeNoteStoreContract } from "./note-store.contract";

describeNoteStoreContract("memory", async (clock) => createMemoryNoteStore({ clock }));
