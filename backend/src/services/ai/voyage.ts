// Voyage implementation of EmbeddingProvider — the model decided in the
// requirements doc (voyage-3.5). Refactored behind the shared interface so
// it's a drop-in alternate: set EMBEDDING_PROVIDER=voyage (+ VOYAGE_API_KEY)
// to switch back. NOTE: voyage-3.5's default output is already EMBEDDING_DIM
// (1024) — no dimensions param needed, unlike the OpenAI provider.
import type { EmbeddingProvider } from "./types.js";

const VOYAGE_API_URL = "https://api.voyageai.com/v1/embeddings";
const MODEL = process.env.VOYAGE_EMBEDDING_MODEL ?? "voyage-3.5";

export const voyageEmbeddings: EmbeddingProvider = {
  async embed(text) {
    const res = await fetch(VOYAGE_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.VOYAGE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: [text],
        model: MODEL,
        input_type: "document",
      }),
    });

    if (!res.ok) {
      throw new Error(`Voyage embedding request failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as { data: { embedding: number[] }[] };
    return data.data[0].embedding;
  },
};
