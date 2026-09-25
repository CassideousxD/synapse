import { describe, expect, it } from "vitest";
import { runLive, type LiveReport, type Scenario } from "../scripts/live-lib";
import { routedLlm, type Reply, type Task } from "./routed-llm";

const DIAG = JSON.stringify({ errorType: "misconception", summary: "Differentiates only one factor.", suspectedMisconception: "Believes (fg)' = f·g'.", confidence: 0.8 });
const PASS = JSON.stringify({ verdict: "pass", objections: [] });
const CLARIFY = JSON.stringify({ verdict: "needs_clarification", objections: [], clarifyingQuestion: "What did you picture happening to the second factor?" });
const SECTION =
  "You picked x·cos(x), which suggests you differentiated only one factor of the product and left the other alone.\n\n" +
  "The product rule says (fg)' = f'g + fg'. See [[Chain Rule]] for composites. That is why the second term matters in every product you will meet.\n\n" +
  "Check yourself: what is d/dx of x·ln(x)?";
const SECTION_2 = `Second time round: ${SECTION}`;
const JSONISH = `{"note": "${"This looks like a note but the model wrapped it in JSON, which is not what we want. ".repeat(2)}"}`;

async function run(script: Partial<Record<Task, Reply[]>>, scenarios: Scenario[]) {
  const fake = routedLlm(script);
  const lines: string[] = [];
  const report: LiveReport = await runLive(fake.llm, { scenarios, log: (l) => lines.push(l) });
  const hardFailures = report.checks.filter((c) => !c.ok && !c.soft);
  return { fake, report, lines, hardFailures };
}
const check = (r: LiveReport, name: string) => r.checks.find((c) => c.name === name);

describe("runLive with a fake model", () => {
  it("A: a clean run passes every hard check, records the calls, and prints the note", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], review_section: [PASS] }, ["a"]);
    expect(t.report.ok).toBe(true);
    expect(t.hardFailures).toEqual([]);
    expect(t.report.calls.map((c) => c.task)).toEqual(["diagnose", "write_section", "review_section"]);
    expect(t.lines.join("\n")).toContain("# Product Rule");
    expect(t.lines.join("\n")).toContain("RESULT: OK");
    expect(t.lines.join("\n")).toMatch(/models used: fast=fake, main=fake/);
  });

  it("A: if the real reviewer asks its own question, the canned answer is given and the run completes", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [SECTION_2], review_section: [CLARIFY, PASS] }, ["a"]);
    expect(t.report.ok).toBe(true);
    expect(t.lines.join("\n")).toContain("the student is asked: What did you picture");
    expect(t.fake.count("revise_section")).toBe(1);
  });

  it("B: injects the first review, reuses that question, and feeds the student's answer to the reviser", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [SECTION_2], review_section: [PASS] }, ["b"]);
    expect(t.report.ok).toBe(true);
    expect(t.report.calls.filter((c) => c.injected).map((c) => c.task)).toEqual(["review_section"]);
    expect(t.fake.count("review_section")).toBe(1); // only the real second review reached the model
    expect(check(t.report, "the revise prompt contained the student's answer")?.ok).toBe(true);
    expect(check(t.report, "reused the reviewer's question (no separate ask_student call)")?.ok).toBe(true);
  });

  it("C: two tests on one concept keep the history and pass", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION, SECTION_2], review_section: [PASS] }, ["c"]);
    expect(t.report.ok).toBe(true);
    for (const name of ["version is 2", "the first note's text is still there, unaltered", "the new update is on top", "both revisions are in the history"]) {
      expect(check(t.report, name)?.ok, name).toBe(true);
    }
  });

  it("runs several scenarios in one go and keeps their calls apart", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [SECTION_2], review_section: [PASS] }, ["a", "b"]);
    expect(t.report.ok).toBe(true);
    expect(new Set(t.report.calls.map((c) => c.scenario))).toEqual(new Set(["a", "b"]));
  });
});

describe("runLive reports problems instead of throwing", () => {
  it("a note that is really JSON fails the hard check, in every scenario that produces it", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [JSONISH], review_section: [PASS] }, ["a", "c"]);
    expect(t.report.ok).toBe(false);
    const failing = t.hardFailures.filter((c) => c.name === "the section is prose, not JSON");
    expect(failing.map((c) => c.scenario)).toContain("a");
    expect(failing.map((c) => c.scenario)).toContain("c");
    expect(t.lines.join("\n")).toContain("RESULT: FAILED");
  });

  it("a persistent model outage is a failed check with the error message, not an exception", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [new Error("NIM 503")] }, ["a"]);
    expect(t.report.ok).toBe(false);
    expect(check(t.report, "ends with a saved note")).toMatchObject({ ok: false, detail: expect.stringContaining("NIM 503") });
    expect(t.report.calls.filter((c) => c.error !== undefined).length).toBeGreaterThanOrEqual(2);
  });

  it("a one-off outage is retried once and the run still passes", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [new Error("NIM 503"), SECTION], review_section: [PASS] }, ["a"]);
    expect(t.report.ok).toBe(true);
    expect(t.lines.join("\n")).toContain("retrying once");
  });

  it("an unexpected exception inside a scenario becomes a failed check, and the next scenario still runs", async () => {
    // diagnose is unscripted, so the fake throws. Scenario a fails; scenario c then runs against the same fake and fails too.
    const t = await run({ write_section: [SECTION] }, ["a", "c"]);
    expect(t.report.ok).toBe(false);
    expect(t.hardFailures.filter((c) => c.name === "scenario ran without throwing").map((c) => c.scenario)).toEqual(["a", "c"]);
  });

  it("counts JSON repairs", async () => {
    const t = await run({ diagnose: ["not json", DIAG], write_section: [SECTION], review_section: [PASS] }, ["a"]);
    expect(t.report.calls.filter((c) => c.repair)).toHaveLength(1);
    expect(t.lines.join("\n")).toMatch(/diagnose\s+calls\s+\d+\s+avg\s+\d+ms\s+repairs 1/);
  });
});
