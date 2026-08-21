import { Router } from "express";
import { db } from "../db/index.js";
import { conversations, messages } from "../db/schema.js";
import { getLLM } from "../services/ai/index.js";
import { getNoteBody } from "../services/noteBody.js";

export const noteActionsRouter = Router();

// POST /notes/:id/actions/summarize
noteActionsRouter.post("/:id/actions/summarize", async (req, res) => {
  const body = await getNoteBody(req.params.id);
  const summary = await getLLM().complete({
    maxTokens: 500,
    messages: [{ role: "user", content: `Summarize this note concisely:\n\n${body}` }],
  });
  res.json({ summary });
});

// POST /notes/:id/actions/polish
noteActionsRouter.post("/:id/actions/polish", async (req, res) => {
  const body = await getNoteBody(req.params.id);
  const polished = await getLLM().complete({
    maxTokens: 2000,
    messages: [
      {
        role: "user",
        content: `Polish this note for clarity and flow, keeping the original meaning and voice. Return only the polished text:\n\n${body}`,
      },
    ],
  });
  res.json({ polished });
});

// POST /notes/:id/chat — scoped chat (SSE stream), "Ask about this"
noteActionsRouter.post("/:id/chat", async (req, res) => {
  const { message, conversation_id } = req.body as {
    message: string;
    conversation_id?: string;
  };
  const noteId = req.params.id;

  let convId = conversation_id;
  if (!convId) {
    const [conv] = await db
      .insert(conversations)
      .values({ scope: "note", noteId })
      .returning();
    convId = conv.id;
  }

  await db.insert(messages).values({ conversationId: convId, role: "user", content: message });

  const body = await getNoteBody(noteId);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const fullText = await getLLM().stream(
      {
        maxTokens: 1000,
        system: `Answer questions about the following note.\n\nNote:\n${body}`,
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
