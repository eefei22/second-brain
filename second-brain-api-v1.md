# Second Brain — API Layer (v1 Draft)

Companion to `second-brain-requirements-v1.md` (data model, matching logic, UI flow). This document defines the REST contract only.

## Stack decisions
- **Style:** REST
- **Auth:** None in v1 (self-hosted, single user, trusted network)
- **Backend:** Node/TypeScript, Drizzle ORM (native pgvector support), Postgres + pgvector
- **AI calls:** Claude/OpenAI SDKs for embeddings + LLM (chat, summarize, polish)

---

## 1. Capture & Routing (fragments)

The capture flow is split into two calls: **submit** (embed + get suggestions) and **resolve** (commit the routing decision). This matches the UI: canvas stays open showing suggestion buttons between these two calls.

### `POST /fragments`
Submit a newly captured fragment. Runs embedding + two-stage matching immediately (synchronous — corpus is small enough that this stays fast).

**Request**
```json
{
  "content": "string (text) or attachment ref",
  "type": "text | image",
  "attachment": { "file_path": "...", "mime_type": "...", "filename": "..." } // if type=image
}
```

**Response**
```json
{
  "fragment_id": "uuid",
  "status": "pending",
  "suggestions": {
    "notes": [
      { "note_id": "uuid", "title": "...", "score": 0.87 },
      { "note_id": "uuid", "title": "...", "score": 0.81 }
    ],
    "domains": [
      { "domain_id": "uuid", "name": "Software Engineering", "score": 0.62 }
    ],
    "uncategorized": true
  }
}
```
- `suggestions.notes` omitted/empty if top score is below the similarity floor.
- Ranked order in the array is the button order (best first); `uncategorized` is always rendered last by the frontend regardless of array position.

### `POST /fragments/:id/resolve`
Commits the routing decision.

**Request**
```json
{
  "target": {
    "type": "note | domain | uncategorized",
    "note_id": "uuid",       // if type=note (append target)
    "domain_id": "uuid"      // if type=domain (new note under this domain)
  }
}
```

**Response**
```json
{ "note_id": "uuid", "append_id": "uuid" }
```
- `type: note` → creates a row in `note_appends` under the existing note; triggers title re-suggestion check.
- `type: domain` → creates a new `note` under that domain, plus its first `note_appends` row.
- `type: uncategorized` → creates a new note with `domain_id: null` (or a reserved "Uncategorized" pseudo-domain — implementation detail).

### `POST /fragments/:id/defer`
"Resolve later" — moves the fragment into the queue instead of resolving now.

**Response:** `{ "status": "queued" }`

### `GET /fragments/queue`
List deferred fragments (for the inbox/badge count and later resolution). Returns the same shape as the `POST /fragments` response for each queued item, so the frontend can render the same suggestion-button UI.

---

## 2. Notes

### `GET /notes`
List/browse notes for the left panel tree.

**Query params:** `domain_id`, `parent_folder_id` (optional filters)

**Response:** array of `{ note_id, title, domain_id, parent_folder_id, updated_at }`

### `GET /notes/:id`
Full note detail — rendered body (concatenated non-reverted appends, ordered), metadata, attachments.

### `PATCH /notes/:id`
Manual edits — title override, domain/subfolder reassignment.

### `GET /notes/:id/history`
List of appends (including reverted ones) for the undo/history view.

**Response:** array of `{ append_id, content, created_at, reverted_at }`

### `POST /notes/:id/appends/:append_id/revert`
Undo a specific append (sets `reverted_at`, note body re-renders without it).

### `DELETE /notes/:id`
**Soft delete.** Sets `archived_at`; note is hidden from normal browsing/search but recoverable. No hard delete in v1 — not worth the risk for a personal knowledge base.

### `POST /notes/:id/restore`
Clears `archived_at`, un-archives the note.

### `PUT /notes/:id/snapshot`
The **Edit** action's persistence — creates a `note_snapshots` entry with freeform rewritten content + title. Distinct from `note_appends`: this is manual, freeform editing, not the append-only capture path. The note's rendered view becomes this snapshot going forward (latest snapshot wins over the append log).

**Request:** `{ "title": "string", "content": "string" }`

### `GET /notes/:id/snapshots`
List snapshot history (the Edit-specific undo trail, parallel to `/history` for appends).

---

## 3. Note Actions (revisit flow)

### `POST /notes/:id/actions/summarize`
Returns an LLM-generated summary of the note. Does not modify the note.

### `POST /notes/:id/actions/polish`
Returns a polished rewrite suggestion. Does not auto-apply — frontend shows a diff/preview, user accepts via a follow-up `PATCH`.

### `POST /notes/:id/chat`
Scoped chat about this specific note (the "Ask about this" escape hatch). Streamed via SSE.

**Request:** `{ "message": "string", "conversation_id": "uuid (optional — omit to start a new conversation)" }`

Persists to `conversations` (scope=`note`, linked to this note) and `messages`.

---

## 4. Retrieval

### `GET /search?q=...`
Semantic + keyword search across all notes.

**Response:** array of `{ note_id, title, snippet, score }`

### `POST /chat`
General RAG chat over the whole corpus (not scoped to one note). Streamed via SSE.

**Request:** `{ "message": "string", "conversation_id": "uuid (optional — omit to start a new conversation)" }`

Persists to `conversations` (scope=`global`) and `messages`.

### `GET /conversations/:id`
Fetch a conversation's message history (for reopening a past chat thread).

### `POST /summary/generate`
Triggered by a **Summary button** in the UI, not automatic/scheduled. Generates a summary of a given day's activity (new notes + appends) on demand. **Ephemeral** — nothing is persisted by this call alone.

**Request:** `{ "date": "YYYY-MM-DD (optional, defaults to today)" }`

**Response:** `{ "summary": "string" }`

Frontend then presents **`[Save]` / `[Discard]`** buttons over the result:
- **Discard** — no-op, nothing happens, summary disappears.
- **Save** — the summary text is fed into the normal capture flow (`POST /fragments` → `.../resolve`), exactly as if it had been typed into the canvas. This keeps summaries consistent with everything else in the system: anything you choose to keep goes through the same routing/suggestion UX, rather than having a special-case "save a summary" path.

---

## 5. Domains & Subfolders

### `GET /domains`
List the fixed top-level domains.

### `GET /domains/:id/subfolders`
List subfolders within a domain.

### `GET /subfolders/suggestions`
List pending system-generated subfolder suggestions (per the >4-notes-same-topic heuristic).

### `POST /subfolders/suggestions/:id/accept`
Accept a suggested subfolder split — creates the subfolder and reassigns the relevant notes' `parent_folder_id`.

### `POST /subfolders/suggestions/:id/reject`
Dismiss the suggestion.

---

## Decisions
- **Subfolder suggestions:** generated via a **background job** (periodic, not on every append) — no urgency, avoids slowing down capture.
- **Title re-suggestion:** delivered inline in the `POST /fragments/:id/resolve` response — one round trip, frontend gets it immediately if it meaningfully diverges.
- **Chat endpoints (`POST /notes/:id/chat`, `POST /chat`):** **streamed via SSE** — feels responsive for longer RAG answers, worth the added complexity. Persisted via `conversations`/`messages` tables (see requirements doc data model).
