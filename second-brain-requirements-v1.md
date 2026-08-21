# Second Brain — Requirements (v1 Discovery)

## Problem Statement
Notes are captured but rarely found or reused later. The gap isn't capture — it's retrieval and reuse. Thoughts also arrive as broken fragments across frequent task-switching, so the system needs to help figure out *where a fragment belongs*, not just store it.

## Users
Personal use first. Possible open-source / share later — not a driver of v1 decisions.

## Scale
Personal scale: hundreds to low-thousands of notes over time. Single user.

---

## Core Interaction Model
Button-driven, not chat-first. Typing prompts to an agent is friction the user wants to avoid for routine use. Chat exists as a secondary/optional surface, not the primary interface.

### Capture flow
1. User captures a fragment (text, image, or file/link — see Content Types below).
2. System suggests routing via ranked buttons, most recommended first:
   - Existing note matches (append candidates)
   - Domain suggestions
   - `Uncategorized` always last, always present — minimizes but doesn't eliminate uncategorized notes
3. User taps one option. No auto-apply — every routing decision is confirmed by the user.
4. If "append to existing note" is chosen → fragment is appended directly into the body of that note.

### Domains (fixed, user-defined)
Top-level domains, defined upfront, rarely changed:
- Home Planning
- Software Engineering
- Journaling
- General Life

- Each note has **one primary domain** (required).
- Notes can be tagged/linked across other domains (secondary, non-exclusive).
- **Subfolders within a domain** can be created by the system over time (e.g. `Software Engineering > Project X`) — nested, not flat.

### Revisiting notes
When the user goes back to read a note, contextual action buttons are available:
- Edit
- Summarize
- Polish
- Ask about this (drops into chat as an escape hatch)

### Content types (v1)
- Text / markdown
- Images
- (Voice notes, PDFs, etc. deferred to a later version)

---

## Retrieval & Intelligence Features

| Feature | Priority |
|---|---|
| Semantic + keyword search | v1 |
| Chat-with-notes (RAG over corpus) | v1 |
| End-of-day / on-demand summary | v1 |
| Fragment routing suggestions (append / domain / uncategorized) | v1 |
| System-created subfolders within domains | v1 |
| Proactive/passive resurfacing while writing | **v2+ (deferred)** |

Rationale for deferring resurfacing: it's the highest-effort, hardest-to-tune feature, and needs a working corpus + real usage patterns to design well. Building it first would mean tuning against no data.

---

## Technical Constraints
- **Hosting:** Self-hosted, data owned by user
- **Storage:** Postgres + pgvector (decided)
- **AI layer:** Claude / OpenAI API (not local models) — quality prioritized over data staying fully on-device
- **Interface:** Web app (browser, any device)
- **Build approach:** From scratch, full control; stack flexible, not tied to Java/Spring
- **Content types (v1):** Text and images only (voice notes/PDFs deferred)

## Routing & Naming Logic (decided)
- **Ranking method:** Embedding similarity, first pass.
- **Note naming as the backbone of matching:**
  - Notes have a name, generated/regenerated from full note context as the note grows.
  - Routing suggestions primarily compare a new fragment's embedding against existing **note names** first (cheap, high-signal), before falling back to full-body embeddings for finer matching.
  - Name is re-suggested as a note grows — surfaced to the user only when the suggested name meaningfully diverges from the current one (avoids nagging on every append). Exact trigger threshold TBD.
- **Subfolder creation heuristic:** When a domain accumulates **more than 4 notes** that share a topic (based primarily on note name similarity) and are distinguishable from the rest of the notes in that domain, the system suggests splitting them into a subfolder.
- **Edit history:** Undo and edit history required for appended fragments (so an append can be reviewed/reversed after the fact).

---

## Routing & Naming Logic (decided, cont.)
- **Name-change surfacing:** Re-suggest a name after every append; only surface to the user if the suggestion meaningfully diverges from the current name. Silent otherwise.
- **Attachments (images):** Stored as files with basic metadata (filename, upload date, linked note). No OCR or captioning in v1 — images are not embedded/indexed for semantic search yet. This is a clean hook for a future feature (OCR/captioning → searchable images) without changing the core architecture.
- **Edit history / undo:** Confirmed required. Append-level versioning — each append to a note is a discrete, reversible event, not a silent overwrite. Exact data model to be defined in architecture phase.
- **Matching scope:** Autonomous — stage 1 (name-level) matching searches the **entire corpus, all domains**, no domain pre-scoping. The system guesses the domain rather than requiring the user to pick one before writing.

---

## Architecture — Data Model & Matching Logic (v1, decided)

### Core entities
- **`domains`** — id, name, created_at. Seeded with the 3–7 fixed domains.
- **`notes`** — id, domain_id (**nullable** — null means genuinely uncategorized, not a fake domain), parent_folder_id (nullable), title (system-suggested, user-editable), title_embedding (vector), archived_at (nullable, soft delete), created_at, updated_at.
- **`note_appends`** — id, note_id, content (text or image ref), content_embedding (vector), created_at, reverted_at (nullable). Every fragment landing in a note via the capture/routing flow — including its first — is a row here. Used for the **append-only capture path** and its own undo/history.
- **`note_snapshots`** — id, note_id, content, title, created_at. Created by the manual **Edit** action (see UI Flow). A note's current rendered view = latest snapshot if one exists, else the append log. Keeps freeform manual editing separate from the append-only capture model, without compromising either.
- **`subfolders`** — id, domain_id, name, created_at. `notes.parent_folder_id` points here.
- **`attachments`** — id, note_append_id, file_path, mime_type, filename, created_at. No embedding/indexing in v1 (no OCR/captioning) — schema leaves room for it later.
- **`note_tags`** — note_id, domain_id join table, for secondary (non-primary) domain links.
- **`conversations`** — id, scope (`note | global`), note_id (nullable, set when scope=note), created_at. Backs the chat feature's `conversation_id`.
- **`messages`** — id, conversation_id, role (`user | assistant`), content, created_at. Ordered chat history within a conversation.

**Embedding freshness rule:** `title_embedding` must be regenerated any time a note's title changes — system-suggested or manual — or stage-1 matching silently goes stale against an outdated title.

**Domain centroid recomputation:** piggybacks on the same periodic background job as subfolder suggestions (not recalculated per-note-change) — one job, two related jobs' worth of work.

### Two-stage matching flow (per captured fragment)
1. Embed the fragment.
2. **Stage 1 (name-level):** cosine similarity vs. `notes.title_embedding`, searched across the entire corpus, all domains. Take top-5 candidates.
3. **Stage 2 (body-level):** compare fragment embedding against those 5 candidates' `note_appends.content_embedding` (aggregated per note) to refine/re-rank.
4. If top stage-2 score is below a similarity floor, drop note suggestions entirely and fall back to domain suggestions.
5. **Domain suggestions:** fragment embedding vs. each domain's centroid (average embedding of its notes), ranked.
6. Return ranked buttons: best note matches → domain suggestions → `Uncategorized` (always last, always present).

---

## UI Flow (v1, decided)

### Capture — "blank canvas"
- Keyboard shortcut saves the fragment and triggers the automation pipeline (embed → suggest → route).
- **Default:** canvas stays showing the fragment; ranked suggestion buttons appear inline below it; canvas only clears once a suggestion is chosen.
- **Escape hatch:** a "resolve later" button dismisses the fragment into an **inbox/queue** (badge-counted, in the left panel); canvas clears immediately so writing can continue. Queue items are resolved later through the same button-suggestion UI.

### Layout — three panels (decided)
- **Left:** search bar, inbox/queue badge, domain tree (domains → subfolders → notes, lazy-loaded per expand), pinned "Uncategorized" section. Sort: most recently updated first.
- **Center:** the blank canvas — always present, the default working state. Never displaced by browsing.
- **Right:** note detail view. Opens when a note is clicked in the left panel; closable. Read-only with `[Edit] [Summarize] [Polish] [Ask about this]` action buttons. Does not interact with or clear canvas state — the two are fully independent.
- All three panels: **resizable** (drag handles) and **collapsible** (e.g. full-width canvas when writing, full-width note view when reading).
- **Edit** (in the note detail panel) creates a `note_snapshots` entry — a freeform rewrite with its own history trail, separate from the append-only capture log.

### Frontend stack (decided)
- **React (Vite) + Tailwind** — matches the Node/TypeScript backend, one language end-to-end.
- Resizable/collapsible panels via a library (e.g. `react-resizable-panels`) rather than hand-rolled drag logic.

---

## Deployment / Hosting (decided)
- Runs **locally on the user's laptop**, started on demand — not always-on, no server/NAS/VPS.
- No multi-device sync or mobile capture in v1 (direct consequence of local-only hosting).
- Practical shape: Docker Compose bundling Postgres+pgvector, backend, and frontend — one command to start.

---

## AI & Embedding Configuration (decided)
- **Embedding model: Voyage AI `voyage-3.5`.** Chosen for strong retrieval-focused benchmark performance across varied content domains (matches the mixed nature of this corpus — code, journaling, home planning), and because it's Anthropic's recommended embedding partner, pairing naturally with the Claude API calls already used for chat/summarize/polish. Cost is negligible at this scale (hundreds–low-thousands of notes) regardless of model choice.
- **Similarity floor:** `0.75` cosine similarity as the starting threshold for surfacing a note match at all (below this, fall through to domain suggestions). Starting point only — expected to be tuned empirically after real usage.
- **Top-N stage-1 candidates:** `5` (already set in the matching flow above).
- **Daily summary:** on-demand via a **Summary button** in the UI (not scheduled/automatic). Generates ephemerally; user is then shown **`[Save]` / `[Discard]`**. Save routes the summary through the normal capture/routing flow (same suggestion UX as any other fragment) rather than silently creating a note — keeps one consistent path for anything the user chooses to keep.

---

## Open Questions
None outstanding for architecture/requirements. Remaining decisions (exact embedding thresholds, subfolder cadence for the background job) are expected to be tuned empirically once the system is in use — not blockers to starting the build.
