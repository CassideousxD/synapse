import type { LlmClient } from "@synapse/llm-client";
import type { ChatMessage } from "../src/json";

export type Task = "diagnose" | "write_section" | "revise_section" | "review_section" | "ask_student";
type ChatReq = Parameters<LlmClient["chat"]>[0];

export interface Call {
  task: Task;
  tier: string;
  temperature: number | undefined;
  maxTokens: number | undefined;
  messages: ChatMessage[];
}

/** A reply is a string, an Error to throw (transport failure), or a function of the call. */
export type Reply = string | Error | ((call: Call) => string);

/**
 * Fake LLM that answers by task (the "TASK: x" first line of the system prompt).
 * Each task has a list of replies; the last one repeats. A task nobody scripted throws, so an
 * unexpected model call fails the test loudly instead of returning something plausible.
 */
export function routedLlm(script: Partial<Record<Task, Reply[]>>) {
  const calls: Call[] = [];
  const used: Partial<Record<Task, number>> = {};

  const llm = {
    async chat(req: ChatReq) {
      const first = req.messages[0]?.content ?? "";
      const task = /^TASK: (\w+)/.exec(first)?.[1] as Task | undefined;
      if (task === undefined) throw new Error("routedLlm: the system prompt has no TASK line");
      const replies = script[task];
      if (!replies || replies.length === 0) throw new Error(`routedLlm: unexpected call to unscripted task "${task}"`);
      const n = used[task] ?? 0;
      used[task] = n + 1;
      const call: Call = {
        task,
        tier: req.tier,
        temperature: req.temperature,
        maxTokens: req.maxTokens,
        messages: req.messages.map((m) => ({ ...m })),
      };
      calls.push(call);
      const reply = replies[Math.min(n, replies.length - 1)]!;
      if (reply instanceof Error) throw reply;
      return { content: typeof reply === "function" ? reply(call) : reply, model: "fake" };
    },
  };

  return {
    llm,
    calls,
    count: (task: Task) => calls.filter((c) => c.task === task).length,
    /** Every prompt line sent to the model, joined. For "this never appears" assertions. */
    allText: () => calls.flatMap((c) => c.messages.map((m) => m.content)).join("\n"),
    prompt: (task: Task, nth = 0) => calls.filter((c) => c.task === task)[nth]?.messages.map((m) => m.content).join("\n") ?? "",
  };
}
