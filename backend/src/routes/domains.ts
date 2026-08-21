import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "../db/index.js";
import { domains, subfolders, subfolderSuggestions, notes } from "../db/schema.js";

export const domainsRouter = Router();

// GET /domains — fixed, stable order (alphabetical) since capture UX v2
// shows these as a plain numbered list rather than a scored/ranked one.
domainsRouter.get("/", async (_req, res) => {
  res.json(await db.select().from(domains).orderBy(domains.name));
});

// POST /domains — manual tree management (create)
domainsRouter.post("/", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const [domain] = await db.insert(domains).values({ name: name.trim() }).returning();
  res.json(domain);
});

// PATCH /domains/:id — rename
domainsRouter.patch("/:id", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const [updated] = await db
    .update(domains)
    .set({ name: name.trim() })
    .where(eq(domains.id, req.params.id))
    .returning();
  if (!updated) return res.status(404).json({ error: "domain not found" });
  res.json(updated);
});

// DELETE /domains/:id — hard delete the domain itself; its notes/subfolders
// are NOT deleted, they fall back to Uncategorized via the schema's
// ON DELETE SET NULL / CASCADE foreign keys (see requirements doc: no hard
// delete for notes in v1 — only the organizational container goes away).
domainsRouter.delete("/:id", async (req, res) => {
  await db.delete(domains).where(eq(domains.id, req.params.id));
  res.json({ domain_id: req.params.id, deleted: true });
});

// GET /domains/:id/subfolders
domainsRouter.get("/:id/subfolders", async (req, res) => {
  res.json(await db.select().from(subfolders).where(eq(subfolders.domainId, req.params.id)));
});

// POST /domains/:id/subfolders — create a subfolder under this domain
domainsRouter.post("/:id/subfolders", async (req, res) => {
  const { name } = req.body as { name: string };
  if (!name?.trim()) return res.status(400).json({ error: "name required" });
  const [subfolder] = await db
    .insert(subfolders)
    .values({ domainId: req.params.id, name: name.trim() })
    .returning();
  res.json(subfolder);
});

export const subfoldersRouter = Router();

// PATCH /subfolders/:id — rename and/or move to a different domain. Moving
// also re-parents every note currently in the subfolder to the new domain,
// so a note's domainId never disagrees with its own parentFolderId's domain.
subfoldersRouter.patch("/:id", async (req, res) => {
  const { id } = req.params;
  const { name, domain_id } = req.body as { name?: string; domain_id?: string };

  const updates: Record<string, unknown> = {};
  if (name !== undefined) {
    if (!name.trim()) return res.status(400).json({ error: "name cannot be empty" });
    updates.name = name.trim();
  }
  if (domain_id !== undefined) updates.domainId = domain_id;

  const [updated] = await db.update(subfolders).set(updates).where(eq(subfolders.id, id)).returning();
  if (!updated) return res.status(404).json({ error: "subfolder not found" });

  if (domain_id !== undefined) {
    await db.update(notes).set({ domainId: domain_id }).where(eq(notes.parentFolderId, id));
  }

  res.json(updated);
});

// DELETE /subfolders/:id — its notes fall back to the domain root
// (parentFolderId set null via the schema's foreign key), not deleted.
subfoldersRouter.delete("/:id", async (req, res) => {
  await db.delete(subfolders).where(eq(subfolders.id, req.params.id));
  res.json({ subfolder_id: req.params.id, deleted: true });
});

export const subfolderSuggestionsRouter = Router();

// GET /subfolders/suggestions
subfolderSuggestionsRouter.get("/suggestions", async (_req, res) => {
  res.json(
    await db.select().from(subfolderSuggestions).where(eq(subfolderSuggestions.status, "pending"))
  );
});

// POST /subfolders/suggestions/:id/accept
subfolderSuggestionsRouter.post("/suggestions/:id/accept", async (req, res) => {
  const { id } = req.params;
  const [suggestion] = await db
    .select()
    .from(subfolderSuggestions)
    .where(eq(subfolderSuggestions.id, id));
  if (!suggestion) return res.status(404).json({ error: "suggestion not found" });

  const [folder] = await db
    .insert(subfolders)
    .values({ domainId: suggestion.domainId, name: suggestion.suggestedName })
    .returning();

  const noteIds: string[] = JSON.parse(suggestion.noteIds);
  for (const noteId of noteIds) {
    await db.update(notes).set({ parentFolderId: folder.id }).where(eq(notes.id, noteId));
  }

  await db
    .update(subfolderSuggestions)
    .set({ status: "accepted" })
    .where(eq(subfolderSuggestions.id, id));

  res.json({ subfolder_id: folder.id, moved: noteIds.length });
});

// POST /subfolders/suggestions/:id/reject
subfolderSuggestionsRouter.post("/suggestions/:id/reject", async (req, res) => {
  await db
    .update(subfolderSuggestions)
    .set({ status: "rejected" })
    .where(eq(subfolderSuggestions.id, req.params.id));
  res.json({ rejected: true });
});
