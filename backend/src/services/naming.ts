// Note naming — see requirements doc: "Note naming as the backbone of
// matching" and "Name-change surfacing". Titles are LLM-generated from
// content (not truncated text) because stage-1 matching compares against
// title_embedding, so a meaningless title silently breaks matching for that
// note forever.
import { embed, cosineSimilarity } from "./embeddings.js";
import { getLLM } from "./ai/index.js";

const MAX_TITLE_LENGTH = 80;

// "Exact trigger threshold TBD" per the requirements doc — this is a
// starting point, same spirit as the 0.75 similarity floor in matching.ts.
// Below this cosine similarity between old and new title embeddings, the
// new title is considered a meaningful enough divergence to surface.
const TITLE_DIVERGENCE_FLOOR = 0.9;

export async function generateTitle(content: string): Promise<string> {
  const raw = await getLLM().complete({
    maxTokens: 30,
    messages: [
      {
        role: "user",
        content: `Write a short, specific title (max 8 words) for a note with this content. No quotes, no trailing punctuation, no preamble — return only the title text.\n\n${content}`,
      },
    ],
  });
  const cleaned = raw.trim().replace(/^["'“”]|["'“”]$/g, "");
  return (cleaned || content).slice(0, MAX_TITLE_LENGTH);
}

/**
 * Regenerates a title from a note's full (post-append) body and checks
 * whether it meaningfully diverges from the current title. Always returns
 * the new title + its embedding so the caller can silently refresh
 * title_embedding (the "embedding freshness rule") even when not surfacing
 * the suggestion to the user.
 */
export async function suggestTitle(
  currentTitle: string,
  currentTitleEmbedding: number[] | null,
  fullBody: string
): Promise<{ title: string; embedding: number[]; diverges: boolean }> {
  const title = await generateTitle(fullBody);

  // Unchanged title + an embedding already on file — nothing to do.
  if (title === currentTitle && currentTitleEmbedding) {
    return { title, embedding: currentTitleEmbedding, diverges: false };
  }

  const embedding = await embed(title);
  const diverges =
    !currentTitleEmbedding || cosineSimilarity(currentTitleEmbedding, embedding) < TITLE_DIVERGENCE_FLOOR;
  return { title, embedding, diverges };
}
