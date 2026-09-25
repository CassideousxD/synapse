/**
 * Server-side LLM proxy function.
 * Runs on the TanStack Start server so SYNAPSE_CLIENT_SECRET is NEVER exposed to the browser.
 */
import { createServerFn } from "@tanstack/react-start";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatPayload {
  tier: "fast" | "main" | "heavy";
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export const sendLlmChat = createServerFn({ method: "POST" })
  .validator((d: ChatPayload) => d)
  .handler(async ({ data }) => {
    const backendUrl =
      process.env["VITE_API_BASE_URL"] ||
      process.env["SYNAPSE_API_URL"] ||
      "http://localhost:8000";

    const clientSecret = process.env["SYNAPSE_CLIENT_SECRET"] || "";

    const response = await fetch(`${backendUrl}/llm/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${clientSecret}`,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`LLM proxy error (${response.status}): ${err}`);
    }

    return await response.json();
  });
