import "dotenv/config";
// Patches Express so a rejected promise inside an async route handler is
// forwarded to the error middleware below instead of becoming an unhandled
// rejection that crashes the whole process (this was taking the backend
// down on every AI-provider error). Must be imported before the routers.
import "express-async-errors";
import express from "express";
import cors from "cors";
import { fragmentsRouter } from "./routes/fragments.js";
import { notesRouter } from "./routes/notes.js";
import { noteActionsRouter } from "./routes/noteActions.js";
import { domainsRouter, subfolderSuggestionsRouter } from "./routes/domains.js";
import { retrievalRouter } from "./routes/retrieval.js";

const app = express();
// Local-only, single-user, no auth (see requirements doc) — the frontend
// (port 5173) and backend (port 4000) are different origins, so the browser
// blocks fetches without this. Permissive is fine given the trusted-network
// deployment model; tighten origin: to VITE dev URL if that ever changes.
app.use(cors());
app.use(express.json({ limit: "10mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/fragments", fragmentsRouter);
app.use("/notes", notesRouter);
app.use("/notes", noteActionsRouter); // /notes/:id/actions/*, /notes/:id/chat
app.use("/domains", domainsRouter);
app.use("/subfolders", subfolderSuggestionsRouter);
app.use("/", retrievalRouter); // /search, /chat, /conversations/:id, /summary/generate

// Last-resort error handler — logs and returns 500 instead of crashing the
// process. Express identifies this as the error handler by its 4-arg shape.
app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (res.headersSent) return; // e.g. mid-SSE-stream — can't send a fresh response
  const message = err instanceof Error ? err.message : "internal error";
  res.status(500).json({ error: message });
});

const port = process.env.PORT ?? 4000;
app.listen(port, () => {
  console.log(`second-brain backend listening on :${port}`);
});
