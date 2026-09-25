import type { Attempt, ConceptNode } from "@synapse/contracts";
import { describe, expect, it } from "vitest";
import { buildDiagnosisMessages, diagnoseAttempt, diagnosisValidator } from "../src/diagnosis";
import { LlmOutputError, type ChatMessage } from "../src/json";
import type { QuestionContext } from "../src/types";

const concept: ConceptNode = { id: "c1", name: "Product Rule", summary: "How to differentiate a product of two functions." };
const question: QuestionContext = {
  questionId: "q1",
  stem: "What is d/dx of x·sin(x)?",
  options: [
    { id: "A", text: "cos(x)" },
    { id: "B", text: "sin(x) + x·cos(x)" },
    { id: "C", text: "x·cos(x)" },
  ],
};
const attempt: Attempt = {
  id: "att-SECRET-1", studentId: "stu-SECRET-1", testId: "t1", conceptId: "c1", questionId: "q1",
  selectedOption: "C", correctOption: "B", isCorrect: false, submittedAt: "2026-09-20T09:00:00Z",
};

const good = JSON.stringify({
  errorType: "misconception",
  summary: "The student differentiates only one factor of the product.",
  suspectedMisconception: "Believes (fg)' = f·g'.",
  confidence: 0.8,
});

function fakeLlm(replies: string[]) {
  const requests: { tier: string; temperature?: number; messages: ChatMessage[] }[] = [];
  return {
    requests,
    llm: {
      async chat(req: { tier: "fast" | "main" | "heavy"; messages: ChatMessage[]; temperature?: number }) {
        requests.push({ tier: req.tier, ...(req.temperature !== undefined ? { temperature: req.temperature } : {}), messages: [...req.messages] });
        return { content: replies[Math.min(requests.length - 1, replies.length - 1)]!, model: "fake" };
      },
    },
  };
}

const deps = (llm: ReturnType<typeof fakeLlm>["llm"], extra = {}) => ({
  llm,
  now: () => new Date("2026-09-20T10:00:00Z"),
  newId: () => "diag-1",
  ...extra,
});

describe("diagnoseAttempt", () => {
  it("returns a full, contract-valid Diagnosis: model fields plus code-owned ids and timestamp", async () => {
    const f = fakeLlm([good]);
    const d = await diagnoseAttempt(deps(f.llm), { attempt, question, concept });
    expect(d).toEqual({
      id: "diag-1", attemptId: "att-SECRET-1", studentId: "stu-SECRET-1", conceptId: "c1",
      errorType: "misconception",
      summary: "The student differentiates only one factor of the product.",
      suspectedMisconception: "Believes (fg)' = f·g'.",
      confidence: 0.8,
      createdAt: "2026-09-20T10:00:00.000Z",
    });
    expect(diagnosisValidator.validate(d).ok).toBe(true);
  });

  it("asks the fast tier at temperature 0 by default; the tier can be overridden", async () => {
    const f = fakeLlm([good]);
    await diagnoseAttempt(deps(f.llm), { attempt, question, concept });
    expect(f.requests[0]).toMatchObject({ tier: "fast", temperature: 0 });
    const g = fakeLlm([good]);
    await diagnoseAttempt(deps(g.llm, { tier: "main" }), { attempt, question, concept });
    expect(g.requests[0]?.tier).toBe("main");
  });

  it("shows the model the concept, the wording, the chosen and the correct option, but no ids", async () => {
    const f = fakeLlm([good]);
    await diagnoseAttempt(deps(f.llm), { attempt, question, concept });
    const prompt = f.requests[0]!.messages.map((m) => m.content).join("\n");
    for (const s of ["Product Rule", "How to differentiate a product", "d/dx of x·sin(x)", "The student chose: [C] x·cos(x)", "The correct answer is: [B] sin(x) + x·cos(x)"]) {
      expect(prompt).toContain(s);
    }
    expect(prompt).not.toContain("att-SECRET-1");
    expect(prompt).not.toContain("stu-SECRET-1");
  });

  it("falls back to the raw values when option ids don't match the question's options", () => {
    const odd = { ...attempt, selectedOption: "x·cos(x)", correctOption: "sin(x) + x·cos(x)" };
    const prompt = buildDiagnosisMessages({ attempt: odd, question, concept }).map((m) => m.content).join("\n");
    expect(prompt).toContain("The student chose: x·cos(x)");
    expect(prompt).toContain("The correct answer is: sin(x) + x·cos(x)");
  });

  it("accepts a reply without suspectedMisconception, and leaves the key out", async () => {
    const f = fakeLlm([JSON.stringify({ errorType: "careless", summary: "Probably misread.", confidence: 0.3 })]);
    const d = await diagnoseAttempt(deps(f.llm), { attempt, question, concept });
    expect(d.errorType).toBe("careless");
    expect("suspectedMisconception" in d).toBe(false);
  });

  it("accepts a fenced reply", async () => {
    const f = fakeLlm(["Here you go:\n```json\n" + good + "\n```"]);
    expect((await diagnoseAttempt(deps(f.llm), { attempt, question, concept })).errorType).toBe("misconception");
  });

  it("the model cannot set ids or timestamps: it is told off, retried, and the real id wins", async () => {
    const sneaky = JSON.stringify({ ...JSON.parse(good), id: "hacked", createdAt: "1999-01-01T00:00:00Z" });
    const f = fakeLlm([sneaky, good]);
    const d = await diagnoseAttempt(deps(f.llm), { attempt, question, concept });
    expect(d.id).toBe("diag-1");
    expect(d.createdAt).toBe("2026-09-20T10:00:00.000Z");
    expect(f.requests).toHaveLength(2);
    expect(f.requests[1]!.messages.at(-1)?.content).toMatch(/unexpected property "id"/);
  });

  it("repairs blank text fields, out-of-range confidence, and unknown error types", async () => {
    for (const bad of [
      { errorType: "misconception", summary: "  ", confidence: 0.5 },
      { errorType: "misconception", summary: "ok", suspectedMisconception: "", confidence: 0.5 },
      { errorType: "misconception", summary: "ok", confidence: 1.7 },
      { errorType: "lazy", summary: "ok", confidence: 0.5 },
    ]) {
      const f = fakeLlm([JSON.stringify(bad), good]);
      const d = await diagnoseAttempt(deps(f.llm), { attempt, question, concept });
      expect(d.summary).toMatch(/one factor/);
      expect(f.requests).toHaveLength(2);
    }
  });

  it("throws LlmOutputError if the model never produces a valid diagnosis", async () => {
    const f = fakeLlm(["I don't know."]);
    await expect(diagnoseAttempt(deps(f.llm), { attempt, question, concept })).rejects.toBeInstanceOf(LlmOutputError);
    expect(f.requests).toHaveLength(2);
  });

  it("honours maxRepairs", async () => {
    const f = fakeLlm(["nope"]);
    await expect(diagnoseAttempt(deps(f.llm, { maxRepairs: 0 }), { attempt, question, concept })).rejects.toBeInstanceOf(LlmOutputError);
    expect(f.requests).toHaveLength(1);
  });

  it("refuses correct attempts and mismatched inputs without calling the model", async () => {
    const f = fakeLlm([good]);
    await expect(diagnoseAttempt(deps(f.llm), { attempt: { ...attempt, isCorrect: true }, question, concept })).rejects.toThrow(/nothing to diagnose/);
    await expect(diagnoseAttempt(deps(f.llm), { attempt: { ...attempt, questionId: "q2" }, question, concept })).rejects.toThrow(/question q2/);
    await expect(diagnoseAttempt(deps(f.llm), { attempt, question, concept: { ...concept, id: "c9" } })).rejects.toThrow(/concept c1/);
    expect(f.requests).toHaveLength(0);
  });
});
