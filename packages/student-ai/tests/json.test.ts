import { describe, expect, it } from "vitest";
import { callJson, extractJsonObject, JsonExtractError, LlmOutputError, type ChatMessage } from "../src/json";
import { createValidator, refine } from "../src/validate";

describe("extractJsonObject", () => {
  it("parses a bare object", () => {
    expect(extractJsonObject('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses a fenced block (with or without the json tag)", () => {
    expect(extractJsonObject('Sure!\n```json\n{"a":1}\n```\nHope that helps')).toEqual({ a: 1 });
    expect(extractJsonObject('```\n{"a":2}\n```')).toEqual({ a: 2 });
  });
  it("finds an object buried in prose, even with braces inside strings", () => {
    expect(extractJsonObject('Here you go: {"a":"has } and { braces","b":{"c":1}} bye')).toEqual({
      a: "has } and { braces", b: { c: 1 },
    });
  });
  it("ignores <think> blocks, even if they contain braces", () => {
    expect(extractJsonObject('<think>maybe {"a":0}?</think>{"a":1}')).toEqual({ a: 1 });
  });
  it("skips unparsable candidates and takes the next real object", () => {
    expect(extractJsonObject('{not json} then {"a":3}')).toEqual({ a: 3 });
  });
  it("does not accept arrays or scalars as the answer", () => {
    expect(() => extractJsonObject("[1,2,3]")).toThrow(JsonExtractError);
    expect(() => extractJsonObject("42")).toThrow(JsonExtractError);
  });
  it("throws JsonExtractError when there is nothing", () => {
    expect(() => extractJsonObject("I cannot do that.")).toThrow(JsonExtractError);
    expect(() => extractJsonObject("")).toThrow(JsonExtractError);
  });
});

/** Fake LLM: replies come from a list (last repeats); every request is recorded. */
function fakeLlm(replies: string[]) {
  const requests: { tier: string; messages: ChatMessage[]; temperature?: number; maxTokens?: number }[] = [];
  return {
    requests,
    llm: {
      async chat(req: { tier: "fast" | "main" | "heavy"; messages: ChatMessage[]; temperature?: number; maxTokens?: number }) {
        requests.push({ ...req, messages: [...req.messages] });
        return { content: replies[Math.min(requests.length - 1, replies.length - 1)]!, model: "fake" };
      },
    },
  };
}

const numberSchema = { type: "object", additionalProperties: false, required: ["n"], properties: { n: { type: "integer", minimum: 1 } } };
const validator = createValidator<{ n: number }>("Num", numberSchema);
const base: ChatMessage[] = [{ role: "user", content: "give me n" }];

describe("callJson", () => {
  it("returns the value on a valid first reply (one call, deterministic temperature by default)", async () => {
    const f = fakeLlm(['{"n":2}']);
    expect(await callJson({ llm: f.llm, tier: "fast", messages: base, validator })).toEqual({ n: 2 });
    expect(f.requests).toHaveLength(1);
    expect(f.requests[0]).toMatchObject({ tier: "fast", temperature: 0 });
    expect("maxTokens" in f.requests[0]!).toBe(false);
  });

  it("passes maxTokens and a custom temperature through", async () => {
    const f = fakeLlm(['{"n":2}']);
    await callJson({ llm: f.llm, tier: "main", messages: base, validator, temperature: 0.3, maxTokens: 200 });
    expect(f.requests[0]).toMatchObject({ tier: "main", temperature: 0.3, maxTokens: 200 });
  });

  it("repairs once: the retry shows the bad reply and the exact problems", async () => {
    const f = fakeLlm(['{"n":0,"extra":true}', '{"n":5}']);
    expect(await callJson({ llm: f.llm, tier: "fast", messages: base, validator })).toEqual({ n: 5 });
    expect(f.requests).toHaveLength(2);
    const retry = f.requests[1]!.messages;
    expect(retry).toHaveLength(3);
    expect(retry[1]).toEqual({ role: "assistant", content: '{"n":0,"extra":true}' });
    expect(retry[2]?.content).toMatch(/not a valid Num object/);
    expect(retry[2]?.content).toMatch(/unexpected property "extra"/);
    expect(retry[2]?.content).toMatch(/ONLY one corrected JSON object/);
  });

  it("repairs when the reply had no JSON at all", async () => {
    const f = fakeLlm(["Sorry, here's my thoughts...", '{"n":1}']);
    expect(await callJson({ llm: f.llm, tier: "fast", messages: base, validator })).toEqual({ n: 1 });
    expect(f.requests[1]!.messages[2]?.content).toMatch(/No JSON object found/);
  });

  it("gives up with LlmOutputError after the repair budget", async () => {
    const f = fakeLlm(['{"n":0}']);
    const err = await callJson({ llm: f.llm, tier: "fast", messages: base, validator }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmOutputError);
    expect(err).toMatchObject({ schemaName: "Num", attempts: 2 });
    expect(f.requests).toHaveLength(2);
  });

  it("maxRepairs 0 means a single attempt", async () => {
    const f = fakeLlm(['{"n":0}', '{"n":1}']);
    await expect(callJson({ llm: f.llm, tier: "fast", messages: base, validator, maxRepairs: 0 })).rejects.toBeInstanceOf(LlmOutputError);
    expect(f.requests).toHaveLength(1);
  });

  it("semantic rules from refine() drive the repair too", async () => {
    const even = refine(validator, (v) => (v.n % 2 === 0 ? [] : ["n must be even"]));
    const f = fakeLlm(['{"n":3}', '{"n":4}']);
    expect(await callJson({ llm: f.llm, tier: "fast", messages: base, validator: even })).toEqual({ n: 4 });
    expect(f.requests[1]!.messages[2]?.content).toMatch(/n must be even/);
  });

  it("does not swallow client errors, and does not mutate the caller's messages", async () => {
    const llm = { async chat(): Promise<never> { throw new Error("NIM 500"); } };
    await expect(callJson({ llm, tier: "fast", messages: base, validator })).rejects.toThrow("NIM 500");
    const f = fakeLlm(['{"n":0}', '{"n":1}']);
    await callJson({ llm: f.llm, tier: "fast", messages: base, validator });
    expect(base).toHaveLength(1);
  });
});
