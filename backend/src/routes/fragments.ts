import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { fragments, notes, noteAppends } from "../db/schema.js";
import { embed } from "../services/embeddings.js";
import { getSuggestions, getDomainScopedNoteSuggestions } from "../services/matching.js";
import { generateTitle, suggestTitle, countWords, TITLE_RESUGGEST_MIN_WORDS } from "../services/naming.js";
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
    target: {
      type: "note" | "domain" | "uncategorized";
      note_id?: string;
      domain_id?: string;
      parent_folder_id?: string; // optional — new note goes into this subfolder instead of the domain root
    };
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
        parentFolderId: target.type === "domain" ? target.parent_folder_id ?? null : null,
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

  // Title re-suggestion — only worth checking for a substantial append (see
  // TITLE_RESUGGEST_MIN_WORDS); a one-liner is unlikely to shift the note's
  // topic and isn't worth an LLM call. When it does run: regenerate from the
  // note's full updated body, surface the new title only if it meaningfully
  // diverges from what's *actually stored*. Read-only check — title/
  // titleEmbedding are untouched here regardless of outcome; they only
  // change if the suggestion is applied (PATCH /notes/:id re-embeds there).
  // Persisting the candidate embedding here even when dismissed used to move
  // the comparison baseline out from under the next append, causing
  // spurious repeat suggestions.
  let suggestedTitle: string | undefined;
  if (isAppendToExisting) {
    const [currentNote] = await db.select().from(notes).where(eq(notes.id, noteId));
    if (currentNote && countWords(fragment.content) > TITLE_RESUGGEST_MIN_WORDS) {
      const body = await getNoteBody(noteId);
      const { title, diverges } = await suggestTitle(currentNote.title, currentNote.titleEmbedding, body);
      if (diverges) suggestedTitle = title;
    }
    // Appending changes the note regardless of the title outcome — keep
    // "most recently updated" sorting accurate.
    await db.update(notes).set({ updatedAt: new Date() }).where(eq(notes.id, noteId));
  }

  res.json({ note_id: noteId, append_id: append.id, suggested_title: suggestedTitle });
});

// POST /fragments/:id/defer — "resolve later", moves fragment into the queue
fragmentsRouter.post("/:id/defer", async (req, res) => {
  const { id } = req.params;
  await db.update(fragments).set({ status: "queued" }).where(eq(fragments.id, id));
  res.json({ status: "queued" });
});

// DELETE /fragments/:id — cancel a pending capture (e.g. the user backed out
// of the domain/note picker). Hard delete is fine here — a fragment is just
// a transient routing artifact until resolved, never user content itself.
fragmentsRouter.delete("/:id", async (req, res) => {
  await db.delete(fragments).where(eq(fragments.id, req.params.id));
  res.json({ fragment_id: req.params.id, deleted: true });
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
