import { describe, expect, it } from "vitest";
import { runLive, type LiveReport, type Scenario } from "../scripts/live-lib";
import { buildReviewMessages, buildReviseMessages, buildSectionMessages } from "../src/note-prompts";
import type { NoteRunInput } from "../src/note-types";
import { routedLlm, type Reply, type Task } from "./routed-llm";

/** Regression tests for what the second real-model run turned up. */

const DIAG = JSON.stringify({ errorType: "misconception", summary: "Differentiates only one factor.", suspectedMisconception: "Believes (fg)' = f·g'.", confidence: 0.8 });
const PASS = JSON.stringify({ verdict: "pass", objections: [] });
const REVISE = JSON.stringify({ verdict: "revise", objections: [{ kind: "inaccurate", message: "It says the student missed the wrong term." }] });
const CLARIFY = JSON.stringify({ verdict: "needs_clarification", objections: [], clarifyingQuestion: "Why did you pick C?" });
const SECTION =
  "You picked x·cos(x), which is only the f·g' term.\n\nThe product rule says (fg)' = f'g + fg'. You missed f'g, which here is sin(x). " +
  "That is why the derivative is sin(x) + x·cos(x).\n\nCheck yourself: what is d/dx of x·ln(x)?";
const MISATTRIBUTED = `${SECTION.replace("You missed f'g, which here is sin(x).", "Your answer missed the second term.")}`;

async function run(script: Partial<Record<Task, Reply[]>>, scenarios: Scenario[], tiers?: Parameters<typeof runLive>[1]["tiers"]) {
  const fake = routedLlm(script);
  const lines: string[] = [];
  const report: LiveReport = await runLive(fake.llm, { scenarios, log: (l) => lines.push(l), ...(tiers ? { tiers } : {}) });
  return { fake, report, lines };
}
const find = (r: LiveReport, part: string) => r.checks.find((c) => c.name.includes(part));

describe("finding: a 503 on the very first call made scenario B fail (A, C and D already retried)", () => {
  it("B retries a failed first call once and then carries on", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [new Error("NIM 503"), SECTION], revise_section: [SECTION], review_section: [PASS] }, ["b"]);
    expect(t.report.ok).toBe(true);
    expect(t.lines.join("\n")).toContain("retrying once");
    expect(find(t.report, "asks the injected clarifying question")?.ok).toBe(true);
  });

  it("B still fails clearly if the outage persists", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [new Error("NIM 503")] }, ["b"]);
    expect(t.report.ok).toBe(false);
    expect(find(t.report, "asks the injected clarifying question")).toMatchObject({ ok: false, detail: "status was failed" });
  });
});

describe("finding: the reviewer passed a note that described the student's mistake backwards", () => {
  it("the reviewer prompt now has a checklist that names exactly that failure", () => {
    const p = buildReviewMessages(
      { studentId: "s", cycleId: "t1", concept: { id: "c1", name: "Product Rule", summary: "x" }, linkable: [], mistakes: [], previousMarkdown: null, date: "2026-09-21" },
      "section", [],
    )[0]?.content ?? "";
    expect(p).toContain("Work out the correct answer yourself");
    expect(p).toContain("what their choice got right and what it missed or added wrongly");
    expect(p).toContain("Getting this backwards");
    expect(p.indexOf("Before deciding")).toBeLessThan(p.indexOf("Be strict about accuracy."));
  });

  it("scenario E plants that error; a reviewer that objects earns the check and the run passes", async () => {
    const t = await run({ diagnose: [DIAG], revise_section: [SECTION], review_section: [REVISE, PASS] }, ["e"]);
    expect(t.report.ok).toBe(true);
    expect(t.report.calls.filter((c) => c.injected).map((c) => c.task)).toEqual(["write_section"]);
    expect(find(t.report, "the reviewer objected to a note that misstates")).toMatchObject({ ok: true, soft: true });
    expect(find(t.report, "no longer says the student missed the second term")).toMatchObject({ ok: true, soft: true });
    expect(t.fake.prompt("review_section", 0)).toContain("Your answer missed the second term, x·cos(x)");
  });

  it("scenario E: a reviewer that passes it only warns (it is a measurement, not a gate)", async () => {
    const t = await run({ diagnose: [DIAG], review_section: [PASS] }, ["e"]);
    expect(t.report.ok).toBe(true);
    expect(find(t.report, "the reviewer objected to a note that misstates")).toMatchObject({ ok: false, soft: true });
    expect(find(t.report, "no longer says the student missed the second term")).toMatchObject({ ok: false, soft: true });
  });

  it("scenario E warns if the final note still says the student missed the second term", async () => {
    const t = await run({ diagnose: [DIAG], revise_section: [MISATTRIBUTED], review_section: [REVISE, PASS] }, ["e"]);
    expect(find(t.report, "the reviewer objected to a note that misstates")?.ok).toBe(true);
    expect(find(t.report, "no longer says the student missed the second term")).toMatchObject({ ok: false, soft: true });
  });
});

describe("--review-tier: comparing a stronger reviewer", () => {
  it("tiers passed to runLive reach the pipeline: only the review step changes", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], review_section: [PASS] }, ["a"], { review: "heavy" });
    expect(t.report.ok).toBe(true);
    expect(t.report.calls.map((c) => [c.task, c.tier])).toEqual([["diagnose", "fast"], ["write_section", "main"], ["review_section", "heavy"]]);
    expect(t.lines.join("\n")).toMatch(/models used: fast=fake, main=fake, heavy=fake/);
  });

  it("without tiers nothing changes", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], review_section: [PASS] }, ["a"]);
    expect(t.report.calls.find((c) => c.task === "review_section")?.tier).toBe("main");
  });

  it("a reviewer question (needs_clarification) still flows through with a custom tier", async () => {
    const t = await run({ diagnose: [DIAG], write_section: [SECTION], revise_section: [SECTION], review_section: [CLARIFY, PASS] }, ["a"], { review: "heavy" });
    expect(t.report.ok).toBe(true);
  });
});

describe("readability: the model wrote the whole note as one paragraph", () => {
  it("both writing prompts ask for short paragraphs", () => {
    const input: NoteRunInput = { studentId: "s", cycleId: "t1", concept: { id: "c1", name: "P", summary: "x" }, linkable: [], mistakes: [], previousMarkdown: null, date: "2026-09-21" };
    for (const built of [buildSectionMessages(input), buildReviseMessages(input, "d", [], [])]) {
      expect(built[0]?.content).toContain("Use short paragraphs separated by blank lines");
    }
  });
});
