// Shared "what does this note currently render as" logic — a note's body is
// its latest snapshot if one exists, else its non-reverted appends in order
// (see requirements doc: note_snapshots vs note_appends). Used by GET
// /notes/:id, the note actions (summarize/polish/chat), and title
// re-suggestion after an append.
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { noteAppends, noteSnapshots } from "../db/schema.js";

export async function getNoteBody(noteId: string): Promise<string> {
  const [latestSnapshot] = await db
    .select()
    .from(noteSnapshots)
    .where(eq(noteSnapshots.noteId, noteId))
    .orderBy(sql`${noteSnapshots.createdAt} DESC`)
    .limit(1);

  if (latestSnapshot) return latestSnapshot.content;

  const appends = await db
    .select()
    .from(noteAppends)
    .where(and(eq(noteAppends.noteId, noteId), isNull(noteAppends.revertedAt)))
    .orderBy(noteAppends.createdAt);
  return appends.map((a) => a.content).join("\n\n");
}
