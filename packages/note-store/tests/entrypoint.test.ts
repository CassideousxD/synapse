import { expect, it } from "vitest";

it("package entry loads in plain Node with no indexedDB global (env-agnostic import)", async () => {
  expect(typeof (globalThis as { indexedDB?: unknown }).indexedDB).toBe("undefined");
  const mod = await import("../src/index");
  expect(typeof mod.openIndexedDbNoteStore).toBe("function");
  expect(typeof mod.createMemoryNoteStore).toBe("function");
});
