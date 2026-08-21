import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { fragments, notes, noteAppends } from "../db/schema.js";
import { embed } from "../services/embeddings.js";
import { getSuggestions, getDomainScopedNoteSuggestions } from "../services/matching.js";
import { generateTitle, suggestTitle } from "../services/naming.js";
import { getNoteBody } from "../services/noteBody.js";

export const fragmentsRouter = Router();

// POST /fragments — submit a captured fragment. Capture UX v2 is a two-step
// domain-then-note flow (see GET /:id/domain-matches below), so this no
// longer computes corpus-wide suggestions up front — just embed and store.
fragmentsRouter.post("/", async (req, res) => {
  const { content, type } = req.body as { content: string; type: "text" | "image" };

  const embedding = await embed(content);

  const [fragment] = await db
    .insert(fragments)
    .values({
      contentType: type,
      content,
      contentEmbedding: embedding,
      status: "pending",
    })
    .returning();

  res.json({ fragment_id: fragment.id, status: fragment.status });
});

// GET /fragments/:id/domain-matches?domain_id=... — step 2 of the capture
// flow: once the user has picked a domain (step 1, just the fixed domain
// list — no scoring needed), fetch ranked "Continue: ..." candidates from
// within that domain only.
fragmentsRouter.get("/:id/domain-matches", async (req, res) => {
  const { id } = req.params;
  const domainId = String(req.query.domain_id ?? "");
  if (!domainId) return res.status(400).json({ error: "domain_id query param required" });

  const [fragment] = await db.select().from(fragments).where(eq(fragments.id, id));
  if (!fragment) return res.status(404).json({ error: "fragment not found" });
  if (!fragment.contentEmbedding) return res.json({ notes: [] });

  const noteMatches = await getDomainScopedNoteSuggestions(fragment.contentEmbedding, domainId);
  res.json({ notes: noteMatches });
});

// POST /fragments/:id/resolve — commit the routing decision
fragmentsRouter.post("/:id/resolve", async (req, res) => {
  const { id } = req.params;
  const { target } = req.body as {
    target: { type: "note" | "domain" | "uncategorized"; note_id?: string; domain_id?: string };
  };

  const [fragment] = await db.select().from(fragments).where(eq(fragments.id, id));
  if (!fragment) return res.status(404).json({ error: "fragment not found" });

  let noteId: string;
  const isAppendToExisting = target.type === "note" && !!target.note_id;

  if (isAppendToExisting) {
    noteId = target.note_id!;
  } else {
    // domain or uncategorized: create a new note. Title is LLM-generated
    // from content (not truncated) and embedded immediately — stage-1
    // matching filters on title_embedding IS NOT NULL, so a note without one
    // is permanently invisible to "Continue: ..." suggestions for every
    // fragment captured after it.
    const title = await generateTitle(fragment.content);
    const titleEmbedding = await embed(title);
    const [note] = await db
      .insert(notes)
      .values({
        domainId: target.type === "domain" ? target.domain_id : null,
        title,
        titleEmbedding,
      })
      .returning();
    noteId = note.id;
  }

  const [append] = await db
    .insert(noteAppends)
    .values({
      noteId,
      contentType: fragment.contentType,
      content: fragment.content,
      contentEmbedding: fragment.contentEmbedding,
    })
    .returning();

  await db
    .update(fragments)
    .set({ status: "resolved", resolvedNoteId: noteId, resolvedAppendId: append.id })
    .where(eq(fragments.id, id));

  // Title re-suggestion — regenerate from the note's full updated body,
  // silently refresh title_embedding either way (freshness rule), only
  // surface the new title to the frontend if it meaningfully diverges.
  let suggestedTitle: string | undefined;
  if (isAppendToExisting) {
    const [currentNote] = await db.select().from(notes).where(eq(notes.id, noteId));
    if (currentNote) {
      const body = await getNoteBody(noteId);
      const { title, embedding, diverges } = await suggestTitle(
        currentNote.title,
        currentNote.titleEmbedding,
        body
      );
      await db
        .update(notes)
        .set({ titleEmbedding: embedding, updatedAt: new Date() })
        .where(eq(notes.id, noteId));
      if (diverges) suggestedTitle = title;
    }
  }

  res.json({ note_id: noteId, append_id: append.id, suggested_title: suggestedTitle });
});

// POST /fragments/:id/defer — "resolve later", moves fragment into the queue
fragmentsRouter.post("/:id/defer", async (req, res) => {
  const { id } = req.params;
  await db.update(fragments).set({ status: "queued" }).where(eq(fragments.id, id));
  res.json({ status: "queued" });
});

// GET /fragments/queue — list deferred fragments
fragmentsRouter.get("/queue", async (_req, res) => {
  const queued = await db.select().from(fragments).where(eq(fragments.status, "queued"));

  const withSuggestions = await Promise.all(
    queued.map(async (f) => ({
      fragment_id: f.id,
      status: f.status,
      suggestions: f.contentEmbedding ? await getSuggestions(f.contentEmbedding) : null,
    }))
  );

  res.json(withSuggestions);
});
