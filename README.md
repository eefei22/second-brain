# Second Brain

A local-first, self-hosted note-taking app with AI-assisted routing. See the
companion planning docs (`second-brain-requirements-v1.md`,
`second-brain-api-v1.md`) for the full design rationale — this README is just
setup instructions.

## What's implemented in this scaffold

- **Full database schema** (`backend/src/db/schema.ts`) — all 11 tables from
  the requirements doc, including two additions needed to actually implement
  the documented API: `fragments` (the capture/routing inbox) and
  `subfolder_suggestions` (the background job's output).
- **Two-stage matching logic** (`backend/src/services/matching.ts`) — title
  embedding → body refinement → domain fallback, per the requirements doc.
- **All REST routes** from the API doc — capture/resolve/defer/queue, notes
  CRUD + history + revert + snapshot, note actions (summarize/polish/chat),
  domains/subfolders, search, global chat, on-demand summary.
- **Three-panel frontend** (search+tree / canvas / note detail), resizable
  and collapsible, wired to the backend for capture and browsing.

## What's NOT implemented yet (stubbed or missing — by design, for a v1 scaffold)

- **Background jobs** — subfolder suggestion generation and domain centroid
  recomputation are designed (see requirements doc) but have no worker process
  yet. `domainSuggestions()` in `matching.ts` computes centroids live as a
  placeholder instead.
- **Title re-suggestion after append** — flagged with a `TODO` in
  `fragments.ts`. Needs a Claude call to generate/compare titles.
- **Image attachment upload endpoint** — `attachments` table exists, `multer`
  is installed, but no upload route is wired up yet.
- **Summary Save flow on the frontend** — backend `/summary/generate` exists;
  the frontend doesn't have the Summary button + Save/Discard UI yet.
- **Edit action UI** — the note detail panel has an `[Edit]` button that
  doesn't do anything yet; `PUT /notes/:id/snapshot` exists on the backend.
- **Auth** — intentionally none, per the local-only deployment decision.

## Running it

1. Copy `backend/.env.example` to `backend/.env` and fill in your Anthropic
   and Voyage API keys.
2. From the project root:
   ```
   docker compose up
   ```
3. Run the initial migration (first time only):
   ```
   docker compose exec backend npm run db:migrate
   ```
4. Seed your domains (no UI for this yet — insert directly, e.g. via
   `docker compose exec backend npx drizzle-kit studio`, or a quick SQL
   insert into `domains` for Home Planning / Software Engineering /
   Journaling / General Life).
5. Frontend: http://localhost:5173 — Backend: http://localhost:4000

## Local dev without Docker

Postgres needs the `pgvector` extension either way — easiest to still run
`docker compose up db` for just the database, then:

```
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```
