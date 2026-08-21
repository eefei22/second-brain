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

// Only worth regenerating the title for a substantial append — a one-line
// addition is unlikely to shift the note's overall topic, and this skips an
// LLM call (title regen + re-embed) on every small append.
export const TITLE_RESUGGEST_MIN_WORDS = 200;

export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

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
 * whether it meaningfully diverges from the current title. This is a
 * read-only check — it does NOT persist anything. The note's title/
 * title_embedding only actually change if the caller applies the
 * suggestion (see PATCH /notes/:id, which re-embeds there). Divergence is
 * always measured against the *currently stored* title embedding, so a
 * suggestion that's shown but never applied can't skew the next check.
 */
export async function suggestTitle(
  currentTitle: string,
  currentTitleEmbedding: number[] | null,
  fullBody: string
): Promise<{ title: string; diverges: boolean }> {
  const title = await generateTitle(fullBody);

  if (title === currentTitle) return { title, diverges: false };

  const embedding = await embed(title);
  const diverges =
    !currentTitleEmbedding || cosineSimilarity(currentTitleEmbedding, embedding) < TITLE_DIVERGENCE_FLOOR;
  return { title, diverges };
}
