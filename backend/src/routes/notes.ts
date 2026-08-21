import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { notes, noteAppends, noteSnapshots } from "../db/schema.js";
import { embed } from "../services/embeddings.js";
import { getNoteBody } from "../services/noteBody.js";

export const notesRouter = Router();

// GET /notes?domain_id=&parent_folder_id= — left panel tree browsing
notesRouter.get("/", async (req, res) => {
  const { domain_id, parent_folder_id } = req.query as {
    domain_id?: string;
    parent_folder_id?: string;
  };

  const conditions = [isNull(notes.archivedAt)];
  if (domain_id) conditions.push(eq(notes.domainId, domain_id));
  if (parent_folder_id) conditions.push(eq(notes.parentFolderId, parent_folder_id));
  else if (domain_id) conditions.push(isNull(notes.parentFolderId));

  const rows = await db
    .select({
      note_id: notes.id,
      title: notes.title,
      domain_id: notes.domainId,
      parent_folder_id: notes.parentFolderId,
      updated_at: notes.updatedAt,
    })
    .from(notes)
    .where(and(...conditions))
    .orderBy(sql`${notes.updatedAt} DESC`);

  res.json(rows);
});

// GET /notes/:id — full detail, rendered body = latest snapshot else appends
notesRouter.get("/:id", async (req, res) => {
  const { id } = req.params;
  const [note] = await db.select().from(notes).where(eq(notes.id, id));
  if (!note) return res.status(404).json({ error: "note not found" });

  const body = await getNoteBody(id);

  res.json({ ...note, body });
});

// PATCH /notes/:id — manual title/domain/subfolder edits
notesRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { title, domain_id, parent_folder_id } = req.body as {
    title?: string;
    domain_id?: string | null;
    parent_folder_id?: string | null;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (title !== undefined) {
    updates.title = title;
    updates.titleEmbedding = await embed(title); // embedding freshness rule
  }
  if (domain_id !== undefined) updates.domainId = domain_id;
  if (parent_folder_id !== undefined) updates.parentFolderId = parent_folder_id;

  const [updated] = await db.update(notes).set(updates).where(eq(notes.id, id)).returning();
  res.json(updated);
});

// GET /notes/:id/history — append history (for undo view)
notesRouter.get("/:id/history", async (req, res) => {
  const { id } = req.params;
  const rows = await db
    .select({
      append_id: noteAppends.id,
      content: noteAppends.content,
      created_at: noteAppends.createdAt,
      reverted_at: noteAppends.revertedAt,
    })
    .from(noteAppends)
    .where(eq(noteAppends.noteId, id))
    .orderBy(noteAppends.createdAt);
  res.json(rows);
});

// POST /notes/:id/appends/:append_id/revert — undo a specific append
notesRouter.post("/:id/appends/:append_id/revert", async (req, res) => {
  const { append_id } = req.params;
  await db
    .update(noteAppends)
    .set({ revertedAt: new Date() })
    .where(eq(noteAppends.id, append_id));
  res.json({ append_id, reverted: true });
});

// DELETE /notes/:id — soft delete
notesRouter.delete("/:id", async (req, res) => {
  const { id } = req.params;
  await db.update(notes).set({ archivedAt: new Date() }).where(eq(notes.id, id));
  res.json({ note_id: id, archived: true });
});

// POST /notes/:id/restore — un-archive
notesRouter.post("/:id/restore", async (req, res) => {
  const { id } = req.params;
  await db.update(notes).set({ archivedAt: null }).where(eq(notes.id, id));
  res.json({ note_id: id, archived: false });
});

// PUT /notes/:id/snapshot — the "Edit" action's persistence
notesRouter.put("/:id/snapshot", async (req, res) => {
  const { id } = req.params;
  const { title, content } = req.body as { title: string; content: string };

  const [snapshot] = await db
    .insert(noteSnapshots)
    .values({ noteId: id, title, content })
    .returning();

  const titleEmbedding = await embed(title); // embedding freshness rule
  await db
    .update(notes)
    .set({ title, titleEmbedding, updatedAt: new Date() })
    .where(eq(notes.id, id));

  res.json(snapshot);
});

// GET /notes/:id/snapshots — Edit history trail
notesRouter.get("/:id/snapshots", async (req, res) => {
  const { id } = req.params;
  const rows = await db
    .select()
    .from(noteSnapshots)
    .where(eq(noteSnapshots.noteId, id))
    .orderBy(sql`${noteSnapshots.createdAt} DESC`);
  res.json(rows);
});
