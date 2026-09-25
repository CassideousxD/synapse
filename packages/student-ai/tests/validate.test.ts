/// <reference types="node" />
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { createValidator, pickSchema, refine, type JsonSchema } from "../src/validate";

const dir = new URL("../../../contracts/schemas/", import.meta.url);
const load = (file: string): JsonSchema => JSON.parse(readFileSync(new URL(file, dir), "utf8")) as JsonSchema;

const diagnosisSchema = load("diagnosis.schema.json");
const reviewSchema = load("review-result.schema.json");

const fullDiagnosis = {
  id: "d1", attemptId: "a1", studentId: "s1", conceptId: "c1",
  errorType: "misconception", summary: "Thinks the derivative of a product is the product of derivatives.",
  suspectedMisconception: "(fg)' = f'g'", confidence: 0.8, createdAt: "2026-09-20T10:00:00Z",
};

describe("every contract schema compiles under Ajv strict mode", () => {
  const files = readdirSync(dir).filter((f) => f.endsWith(".schema.json"));
  it("found the schemas", () => expect(files.length).toBeGreaterThanOrEqual(6));
  for (const f of files) {
    it(f, () => expect(() => createValidator(f, load(f))).not.toThrow());
  }
});

describe("createValidator (Diagnosis)", () => {
  const v = createValidator<typeof fullDiagnosis>("Diagnosis", diagnosisSchema);

  it("accepts a valid object", () => {
    expect(v.validate(fullDiagnosis)).toEqual({ ok: true, value: fullDiagnosis });
  });

  it("rejects extra properties, naming them", () => {
    const r = v.validate({ ...fullDiagnosis, mood: "sad" });
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.errors.join()).toMatch(/unexpected property "mood"/);
  });

  it("rejects a bad enum value and lists the allowed ones", () => {
    const r = v.validate({ ...fullDiagnosis, errorType: "lazy" });
    expect(!r.ok && r.errors.join()).toMatch(/misconception.*missing_prerequisite.*careless.*unknown/);
  });

  it("rejects out-of-range confidence and malformed timestamps", () => {
    expect(v.validate({ ...fullDiagnosis, confidence: 1.5 }).ok).toBe(false);
    expect(v.validate({ ...fullDiagnosis, createdAt: "yesterday" }).ok).toBe(false);
  });

  it("names missing required properties", () => {
    const { summary: _s, ...rest } = fullDiagnosis;
    const r = v.validate(rest);
    expect(!r.ok && r.errors.join()).toMatch(/missing required property "summary"/);
  });

  it("caps the number of reported errors", () => {
    const r = v.validate({});
    expect(!r.ok && r.errors.length).toBeLessThanOrEqual(8);
  });
});

describe("pickSchema: what the LLM is allowed to produce", () => {
  const draft = createValidator<{ errorType: string; summary: string; confidence: number }>(
    "Diagnosis",
    pickSchema(diagnosisSchema, ["errorType", "summary", "suspectedMisconception", "confidence"]),
  );

  it("accepts the semantic fields without ids or timestamps; optional fields stay optional", () => {
    expect(draft.validate({ errorType: "careless", summary: "Slip.", confidence: 0.4 }).ok).toBe(true);
  });

  it("refuses system-owned fields (the model can't set ids or timestamps)", () => {
    const r = draft.validate({ errorType: "careless", summary: "Slip.", confidence: 0.4, id: "hacked" });
    expect(!r.ok && r.errors.join()).toMatch(/unexpected property "id"/);
  });

  it("still enforces the contract's own rules", () => {
    expect(draft.validate({ errorType: "nope", summary: "x", confidence: 0.4 }).ok).toBe(false);
    expect(draft.validate({ errorType: "careless", summary: "x", confidence: 2 }).ok).toBe(false);
  });

  it("works for ReviewResult too, and rejects unknown keys", () => {
    const rv = createValidator("ReviewResult", pickSchema(reviewSchema, ["verdict", "objections", "clarifyingQuestion"]));
    expect(rv.validate({ verdict: "pass", objections: [] }).ok).toBe(true);
    expect(rv.validate({ verdict: "revise", objections: [{ kind: "unclear", message: "m" }] }).ok).toBe(true);
    expect(rv.validate({ verdict: "revise", objections: [{ kind: "vibes", message: "m" }] }).ok).toBe(false);
    expect(() => pickSchema(reviewSchema, ["verdict", "nonsense"])).toThrow(/unknown property nonsense/);
  });
});

describe("refine: semantic rules on top of the schema", () => {
  const base = createValidator<{ verdict: string; objections: unknown[] }>(
    "ReviewResult",
    pickSchema(reviewSchema, ["verdict", "objections"]),
  );
  const rule = refine(base, (r) => (r.verdict === "revise" && r.objections.length === 0 ? ["verdict is revise but there are no objections"] : []));

  it("passes values that satisfy the rule", () => {
    expect(rule.validate({ verdict: "pass", objections: [] }).ok).toBe(true);
  });
  it("turns rule violations into errors", () => {
    const r = rule.validate({ verdict: "revise", objections: [] });
    expect(!r.ok && r.errors).toEqual(["verdict is revise but there are no objections"]);
  });
  it("reports schema errors first and skips the rule", () => {
    const r = rule.validate({ verdict: "maybe", objections: [] });
    expect(!r.ok && r.errors.join()).toMatch(/must be one of/);
  });
});
