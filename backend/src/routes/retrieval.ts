import { Router } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../db/index.js";
import { notes, noteAppends, conversations, messages } from "../db/schema.js";
import { embed } from "../services/embeddings.js";
import { getLLM } from "../services/ai/index.js";

export const retrievalRouter = Router();

// GET /search?q=... — semantic + keyword search across all notes
retrievalRouter.get("/search", async (req, res) => {
  const q = String(req.query.q ?? "");
  if (!q) return res.json([]);

  const queryEmbedding = await embed(q);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;

  // Semantic (title embedding) + basic keyword fallback via ILIKE.
  const rows = await db
    .select({
      note_id: notes.id,
      title: notes.title,
      score: sql<number>`1 - (${notes.titleEmbedding} <=> ${vectorLiteral}::vector)`,
    })
    .from(notes)
    .where(
      sql`${notes.archivedAt} IS NULL AND (${notes.titleEmbedding} IS NOT NULL OR ${notes.title} ILIKE ${"%" + q + "%"})`
    )
    .orderBy(sql`${notes.titleEmbedding} <=> ${vectorLiteral}::vector`)
    .limit(20);

  res.json(rows);
});

// POST /chat — global RAG chat over the whole corpus (SSE stream)
retrievalRouter.post("/chat", async (req, res) => {
  const { message, conversation_id } = req.body as {
    message: string;
    conversation_id?: string;
  };

  let convId = conversation_id;
  if (!convId) {
    const [conv] = await db.insert(conversations).values({ scope: "global" }).returning();
    convId = conv.id;
  }
  await db.insert(messages).values({ conversationId: convId, role: "user", content: message });

  // Simple RAG: embed the question, pull top-5 notes by title similarity as context.
  const queryEmbedding = await embed(message);
  const vectorLiteral = `[${queryEmbedding.join(",")}]`;
  const context = await db
    .select({ title: notes.title, id: notes.id })
    .from(notes)
    .where(sql`${notes.archivedAt} IS NULL AND ${notes.titleEmbedding} IS NOT NULL`)
    .orderBy(sql`${notes.titleEmbedding} <=> ${vectorLiteral}::vector`)
    .limit(5);

  const contextBodies = await Promise.all(
    context.map(async (n) => {
      const appends = await db
        .select()
        .from(noteAppends)
        .where(and(eq(noteAppends.noteId, n.id), isNull(noteAppends.revertedAt)));
      return `## ${n.title}\n${appends.map((a) => a.content).join("\n")}`;
    })
  );

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const fullText = await getLLM().stream(
      {
        maxTokens: 1000,
        system: `Answer questions using the following notes as context:\n\n${contextBodies.join("\n\n")}`,
        messages: [{ role: "user", content: message }],
      },
      (delta) => res.write(`data: ${JSON.stringify({ delta })}\n\n`)
    );
    await db
      .insert(messages)
      .values({ conversationId: convId!, role: "assistant", content: fullText });
    res.write(`data: ${JSON.stringify({ done: true, conversation_id: convId })}\n\n`);
  } catch (err) {
    res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : "stream failed" })}\n\n`);
  } finally {
    res.end();
  }
});

// GET /conversations/:id — fetch message history
retrievalRouter.get("/conversations/:id", async (req, res) => {
  const rows = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, req.params.id))
    .orderBy(messages.createdAt);
  res.json(rows);
});

// POST /summary/generate — on-demand, button-triggered, ephemeral.
// Frontend shows [Save]/[Discard]; Save re-enters the normal /fragments flow.
retrievalRouter.post("/summary/generate", async (req, res) => {
  const { date } = req.body as { date?: string };
  const targetDate = date ?? new Date().toISOString().slice(0, 10);
  const start = new Date(`${targetDate}T00:00:00`);
  const end = new Date(`${targetDate}T23:59:59`);

  const todaysAppends = await db
    .select({ content: noteAppends.content, title: notes.title })
    .from(noteAppends)
    .innerJoin(notes, eq(notes.id, noteAppends.noteId))
    .where(sql`${noteAppends.createdAt} BETWEEN ${start} AND ${end}`);

  if (todaysAppends.length === 0) {
    return res.json({ summary: `Nothing captured on ${targetDate}.` });
  }

  const text = todaysAppends.map((a) => `[${a.title}] ${a.content}`).join("\n");
  const summary = await getLLM().complete({
    maxTokens: 500,
    messages: [{ role: "user", content: `Summarize today's captured notes concisely:\n\n${text}` }],
  });
  res.json({ summary });
});
