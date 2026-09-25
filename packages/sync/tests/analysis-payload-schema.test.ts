import { describe, it, expect } from "vitest";
import schema from "../../../contracts/schemas/analysis-payload.schema.json";

describe("AnalysisPayload contract", () => {
  it("is closed: no extra fields can cross the boundary", () => {
    expect(schema.additionalProperties).toBe(false);
  });

  it("carries only the derived fields", () => {
    expect(Object.keys(schema.properties).sort()).toEqual([
      "computedAt",
      "conceptId",
      "mastery",
      "studentId",
      "trend",
    ]);
  });
});
