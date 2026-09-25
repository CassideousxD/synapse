export type ModelTier = "fast" | "main" | "heavy";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatRequest {
  tier: ModelTier;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
}

export interface ChatResult {
  content: string;
  model: string;
  usage?: { promptTokens: number; completionTokens: number };
}

/** Everything else in Synapse depends on THIS, never on a concrete provider. */
export interface LlmClient {
  chat(req: ChatRequest): Promise<ChatResult>;
}

export class LlmError extends Error {
  readonly status: number | undefined;
  readonly retryable: boolean;

  constructor(message: string, status?: number, retryable = false) {
    super(message);
    this.name = "LlmError";
    this.status = status;
    this.retryable = retryable;
  }
}
