// Provider-agnostic interfaces for the AI layer. Concrete providers
// (openai.ts, anthropic.ts, voyage.ts) implement these; index.ts picks
// which one is active via LLM_PROVIDER / EMBEDDING_PROVIDER env vars.
// Goal: swapping models/vendors later is a config change, not a rewrite.

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface CompleteParams {
  system?: string;
  messages: ChatMessage[];
  maxTokens: number;
}

export interface LLMProvider {
  /** Non-streaming completion — returns the full text. */
  complete(params: CompleteParams): Promise<string>;
  /** Streaming completion — invokes onDelta per chunk, resolves with full text at the end. */
  stream(params: CompleteParams, onDelta: (delta: string) => void): Promise<string>;
}

export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}
