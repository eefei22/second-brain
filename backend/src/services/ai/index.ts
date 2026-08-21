// Provider factory — the one place that decides which vendor is active.
// Hot-swap models/vendors by changing LLM_PROVIDER / EMBEDDING_PROVIDER in
// .env, no code changes. Everything else in the backend goes through
// getLLM() / getEmbedder() (or the embed() re-export in ../embeddings.ts)
// rather than importing a vendor SDK directly.
import type { LLMProvider, EmbeddingProvider } from "./types.js";
import { openaiLLM, openaiEmbeddings } from "./openai.js";
import { anthropicLLM } from "./anthropic.js";
import { voyageEmbeddings } from "./voyage.js";

const llmProviders: Record<string, LLMProvider> = {
  openai: openaiLLM,
  anthropic: anthropicLLM,
};

const embeddingProviders: Record<string, EmbeddingProvider> = {
  openai: openaiEmbeddings,
  voyage: voyageEmbeddings,
};

export function getLLM(): LLMProvider {
  const key = process.env.LLM_PROVIDER ?? "openai";
  const provider = llmProviders[key];
  if (!provider) {
    throw new Error(
      `Unknown LLM_PROVIDER "${key}". Valid options: ${Object.keys(llmProviders).join(", ")}`
    );
  }
  return provider;
}

export function getEmbedder(): EmbeddingProvider {
  const key = process.env.EMBEDDING_PROVIDER ?? "openai";
  const provider = embeddingProviders[key];
  if (!provider) {
    throw new Error(
      `Unknown EMBEDDING_PROVIDER "${key}". Valid options: ${Object.keys(embeddingProviders).join(", ")}`
    );
  }
  return provider;
}

export type { LLMProvider, EmbeddingProvider, ChatMessage, CompleteParams } from "./types.js";
