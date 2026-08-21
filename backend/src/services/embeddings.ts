// Public entry point for embeddings — kept as a thin re-export so callers
// (fragments.ts, notes.ts, matching.ts, retrieval.ts) don't need to know
// which vendor is active. See ./ai/index.ts for provider selection.
import { getEmbedder } from "./ai/index.js";

export async function embed(text: string): Promise<number[]> {
  return getEmbedder().embed(text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
