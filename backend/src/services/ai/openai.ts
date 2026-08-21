import OpenAI from "openai";
import type { LLMProvider, EmbeddingProvider, CompleteParams } from "./types.js";
import { EMBEDDING_DIM } from "../../db/schema.js";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CHAT_MODEL = process.env.OPENAI_CHAT_MODEL ?? "gpt-4o";
const EMBEDDING_MODEL = process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small";

function toChatMessages(params: CompleteParams) {
  const msgs: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (params.system) msgs.push({ role: "system", content: params.system });
  msgs.push(...params.messages);
  return msgs;
}

export const openaiLLM: LLMProvider = {
  async complete(params) {
    const result = await client.chat.completions.create({
      model: CHAT_MODEL,
      max_tokens: params.maxTokens,
      messages: toChatMessages(params),
    });
    return result.choices[0]?.message?.content ?? "";
  },

  async stream(params, onDelta) {
    const stream = await client.chat.completions.create({
      model: CHAT_MODEL,
      max_tokens: params.maxTokens,
      messages: toChatMessages(params),
      stream: true,
    });

    let full = "";
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content ?? "";
      if (delta) {
        full += delta;
        onDelta(delta);
      }
    }
    return full;
  },
};

// text-embedding-3-small/large support the `dimensions` param (Matryoshka
// truncation) — pinned to EMBEDDING_DIM so it matches the schema's vector
// column regardless of which embedding provider is active.
export const openaiEmbeddings: EmbeddingProvider = {
  async embed(text) {
    const result = await client.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIM,
    });
    return result.data[0].embedding;
  },
};
