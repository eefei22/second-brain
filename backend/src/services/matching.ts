import { sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { domains, notes, noteAppends } from "../db/schema.js";

// See requirements doc: "Two-stage matching flow (per captured fragment)"
const STAGE1_TOP_N = 5;
const SIMILARITY_FLOOR = 0.75; // starting point — tune empirically, see AI & Embedding Configuration

// Domain-scoped flow (capture UX v2): once the user has picked a domain,
// candidates are pulled from within it only, ranked top-N. No similarity
// floor here — the user already committed to this domain, so even a weak
// match is more useful shown than hidden; they decide from the ranked list.
const DOMAIN_SCOPED_TOP_N = 7;

export interface NoteSuggestion {
  noteId: string;
  title: string;
  score: number;
}

export interface DomainSuggestion {
  domainId: string;
  name: string;
  score: number;
}

/**
 * Stage 1: cosine similarity vs. notes.title_embedding across the ENTIRE
 * corpus, all domains — no domain scoping (per "autonomous" matching decision).
 */
async function stage1TitleCandidates(fragmentEmbedding: number[]) {
  const vectorLiteral = `[${fragmentEmbedding.join(",")}]`;
  return db
    .select({
      id: notes.id,
      title: notes.title,
      score: sql<number>`1 - (${notes.titleEmbedding} <=> ${vectorLiteral}::vector)`,
    })
    .from(notes)
    .where(sql`${notes.archivedAt} IS NULL AND ${notes.titleEmbedding} IS NOT NULL`)
    .orderBy(sql`${notes.titleEmbedding} <=> ${vectorLiteral}::vector`)
    .limit(STAGE1_TOP_N);
}

/**
 * Stage 2: refine the stage-1 candidates against their body (note_appends)
 * embeddings — averaged per note — for finer-grained re-ranking.
 */
async function stage2BodyRefine(
  fragmentEmbedding: number[],
  candidateNoteIds: string[]
): Promise<NoteSuggestion[]> {
  if (candidateNoteIds.length === 0) return [];
  const vectorLiteral = `[${fragmentEmbedding.join(",")}]`;

  const rows = await db
    .select({
      noteId: noteAppends.noteId,
      title: notes.title,
      score: sql<number>`avg(1 - (${noteAppends.contentEmbedding} <=> ${vectorLiteral}::vector))`,
    })
    .from(noteAppends)
    .innerJoin(notes, sql`${notes.id} = ${noteAppends.noteId}`)
    .where(
      sql`${noteAppends.noteId} IN ${candidateNoteIds} AND ${noteAppends.revertedAt} IS NULL AND ${noteAppends.contentEmbedding} IS NOT NULL`
    )
    .groupBy(noteAppends.noteId, notes.title)
    .orderBy(sql`avg(1 - (${noteAppends.contentEmbedding} <=> ${vectorLiteral}::vector)) DESC`);

  return rows.map((r) => ({ noteId: r.noteId, title: r.title, score: r.score }));
}

/**
 * Domain centroid comparison — fallback when no note match clears the floor.
 * NOTE: centroids are recomputed by the periodic background job (see
 * requirements doc), not live here — this reads whatever was last computed.
 */
async function domainSuggestions(fragmentEmbedding: number[]): Promise<DomainSuggestion[]> {
  // Placeholder simple version: compare against each domain's notes' title
  // embeddings averaged on the fly. Swap for a precomputed centroid column
  // once the background job (see backend/src/jobs/) is wired up.
  const vectorLiteral = `[${fragmentEmbedding.join(",")}]`;
  const rows = await db
    .select({
      domainId: domains.id,
      name: domains.name,
      score: sql<number>`coalesce(avg(1 - (${notes.titleEmbedding} <=> ${vectorLiteral}::vector)), 0)`,
    })
    .from(domains)
    .leftJoin(notes, sql`${notes.domainId} = ${domains.id} AND ${notes.titleEmbedding} IS NOT NULL`)
    .groupBy(domains.id, domains.name)
    .orderBy(sql`coalesce(avg(1 - (${notes.titleEmbedding} <=> ${vectorLiteral}::vector)), 0) DESC`);

  return rows;
}

/**
 * Domain-scoped stage 1: same title-embedding comparison as
 * stage1TitleCandidates, but restricted to one domain. Pulls a generous
 * candidate set (not just DOMAIN_SCOPED_TOP_N) so stage 2's re-ranking has
 * enough to work with before the final top-N cut.
 */
async function stage1TitleCandidatesInDomain(fragmentEmbedding: number[], domainId: string) {
  const vectorLiteral = `[${fragmentEmbedding.join(",")}]`;
  return db
    .select({
      id: notes.id,
      title: notes.title,
      score: sql<number>`1 - (${notes.titleEmbedding} <=> ${vectorLiteral}::vector)`,
    })
    .from(notes)
    .where(
      sql`${notes.archivedAt} IS NULL AND ${notes.domainId} = ${domainId} AND ${notes.titleEmbedding} IS NOT NULL`
    )
    .orderBy(sql`${notes.titleEmbedding} <=> ${vectorLiteral}::vector`)
    .limit(20);
}

export async function getDomainScopedNoteSuggestions(
  fragmentEmbedding: number[],
  domainId: string
): Promise<NoteSuggestion[]> {
  const stage1 = await stage1TitleCandidatesInDomain(fragmentEmbedding, domainId);
  const refined = await stage2BodyRefine(
    fragmentEmbedding,
    stage1.map((c) => c.id)
  );
  return refined.slice(0, DOMAIN_SCOPED_TOP_N);
}

export async function getSuggestions(fragmentEmbedding: number[]) {
  const stage1 = await stage1TitleCandidates(fragmentEmbedding);
  const refined = await stage2BodyRefine(
    fragmentEmbedding,
    stage1.map((c) => c.id)
  );

  const topScore = refined[0]?.score ?? 0;
  const noteSuggestions = topScore >= SIMILARITY_FLOOR ? refined : [];

  const domainSugg = await domainSuggestions(fragmentEmbedding);

  return {
    notes: noteSuggestions,
    domains: domainSugg,
    uncategorized: true, // always present, always last — rendered client-side
  };
}
