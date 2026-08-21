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

// GET /domains/:id/subfolders
domainsRouter.get("/:id/subfolders", async (req, res) => {
  res.json(await db.select().from(subfolders).where(eq(subfolders.domainId, req.params.id)));
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
