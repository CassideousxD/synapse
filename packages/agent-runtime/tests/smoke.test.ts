import { describe, it, expect } from "vitest";
import * as runtime from "../src";

describe("workspace", () => {
  it("resolves the package entry", () => {
    expect(runtime).toBeDefined();
  });
});
