import type { LlmClient } from "@synapse/llm-client";
import type { Validator } from "./validate";

type ChatRequest = Parameters<LlmClient["chat"]>[0];
export type Tier = ChatRequest["tier"];
export type ChatMessage = ChatRequest["messages"][number];

export class JsonExtractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JsonExtractError";
  }
}

/** The model's reply never became a valid object, even after repair attempts. */
export class LlmOutputError extends Error {
  readonly schemaName: string;
  readonly attempts: number;
  readonly errors: string[];
  constructor(schemaName: string, attempts: number, errors: string[]) {
    super(`Model output failed ${schemaName} validation after ${attempts} attempt(s): ${errors.join("; ")}`);
    this.name = "LlmOutputError";
    this.schemaName = schemaName;
    this.attempts = attempts;
    this.errors = errors;
  }
}

// Defensive: some reasoning models wrap their thinking in <think> tags. Braces in there would confuse extraction.
const THINK_RE = /<think>[\s\S]*?<\/think>/gi;

function tryParseObject(s: string): Record<string, unknown> | undefined {
  try {
    const v: unknown = JSON.parse(s);
    if (typeof v === "object" && v !== null && !Array.isArray(v)) return v as Record<string, unknown>;
  } catch {
    // not JSON
  }
  return undefined;
}

/** Index of the "}" matching the "{" at `start` (string- and escape-aware), or -1. */
function balancedEnd(text: string, start: number): number {
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Pull the first JSON object out of a model reply: bare, fenced, or buried in prose. */
export function extractJsonObject(raw: string): Record<string, unknown> {
  const text = raw.replace(THINK_RE, "").trim();

  const whole = tryParseObject(text);
  if (whole) return whole;

  for (const m of text.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) {
    const fenced = tryParseObject((m[1] ?? "").trim());
    if (fenced) return fenced;
  }

  for (let i = text.indexOf("{"); i !== -1; i = text.indexOf("{", i + 1)) {
    const end = balancedEnd(text, i);
    if (end === -1) continue;
    const found = tryParseObject(text.slice(i, end + 1));
    if (found) return found;
  }
  throw new JsonExtractError("No JSON object found in the reply");
}

export interface CallJsonOptions<T> {
  llm: Pick<LlmClient, "chat">;
  tier: Tier;
  messages: ChatMessage[];
  validator: Validator<T>;
  /** Extra attempts after the first, each told exactly what was wrong. Default 1. */
  maxRepairs?: number;
  /** Default 0: we want deterministic structure, not creativity. */
  temperature?: number;
  maxTokens?: number;
}

function repairPrompt(name: string, errors: string[]): string {
  return [
    `Your previous reply was not a valid ${name} object. Problems:`,
    ...errors.map((e) => `- ${e}`),
    "Reply again with ONLY one corrected JSON object. No prose, no code fences.",
  ].join("\n");
}

/**
 * Ask the model for a JSON object and return it validated.
 * On invalid output, shows the model its own reply plus the exact problems and tries again.
 * LlmError from the client (network, 4xx/5xx after its own retries) is NOT caught here.
 */
export async function callJson<T>(opts: CallJsonOptions<T>): Promise<T> {
  const maxRepairs = opts.maxRepairs ?? 1;
  const temperature = opts.temperature ?? 0;
  let messages: ChatMessage[] = [...opts.messages];
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt <= maxRepairs; attempt++) {
    const res = await opts.llm.chat({
      tier: opts.tier,
      messages,
      temperature,
      ...(opts.maxTokens !== undefined ? { maxTokens: opts.maxTokens } : {}),
    });

    let errors: string[];
    try {
      const result = opts.validator.validate(extractJsonObject(res.content));
      if (result.ok) return result.value;
      errors = result.errors;
    } catch (e) {
      if (!(e instanceof JsonExtractError)) throw e;
      errors = [e.message];
    }

    lastErrors = errors;
    messages = [
      ...messages,
      { role: "assistant", content: res.content },
      { role: "user", content: repairPrompt(opts.validator.name, errors) },
    ];
  }
  throw new LlmOutputError(opts.validator.name, maxRepairs + 1, lastErrors);
}
