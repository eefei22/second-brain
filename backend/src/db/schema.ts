import {
  pgTable,
  uuid,
  text,
  timestamp,
  vector,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";

// Voyage voyage-3.5 default output dimension. See requirements doc: AI & Embedding Configuration.
export const EMBEDDING_DIM = 1024;

// ---------------------------------------------------------------------------
// Domains — the fixed, user-defined top-level buckets (3-7, rarely changed)
// ---------------------------------------------------------------------------
export const domains = pgTable("domains", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Subfolders — system-suggested (background job), scoped to a domain
// ---------------------------------------------------------------------------
export const subfolders = pgTable("subfolders", {
  id: uuid("id").primaryKey().defaultRandom(),
  domainId: uuid("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Notes — domain_id is NULLABLE: null means genuinely Uncategorized,
// not a fake domain. title_embedding must be regenerated whenever title
// changes (system-suggested or manual) — see requirements doc.
// ---------------------------------------------------------------------------
export const notes = pgTable("notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  domainId: uuid("domain_id").references(() => domains.id, {
    onDelete: "set null",
  }),
  parentFolderId: uuid("parent_folder_id").references(() => subfolders.id, {
    onDelete: "set null",
  }),
  title: text("title").notNull(),
  titleEmbedding: vector("title_embedding", { dimensions: EMBEDDING_DIM }),
  archivedAt: timestamp("archived_at"), // soft delete
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Note appends — the append-only capture path. Every fragment routed into
// a note (including its first) is a row here. Ordered, non-reverted appends
// = the note's rendered body (unless a snapshot exists — see below).
// ---------------------------------------------------------------------------
export const contentTypeEnum = pgEnum("content_type", ["text", "image"]);

export const noteAppends = pgTable("note_appends", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id")
    .notNull()
    .references(() => notes.id, { onDelete: "cascade" }),
  contentType: contentTypeEnum("content_type").notNull().default("text"),
  content: text("content").notNull(),
  contentEmbedding: vector("content_embedding", {
    dimensions: EMBEDDING_DIM,
  }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  revertedAt: timestamp("reverted_at"), // undo mechanism
});

// ---------------------------------------------------------------------------
// Note snapshots — the manual "Edit" action. Freeform rewrite, own history
// trail, deliberately separate from the append-only capture model.
// Latest snapshot (if any) wins over the append log for rendering.
// ---------------------------------------------------------------------------
export const noteSnapshots = pgTable("note_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteId: uuid("note_id")
    .notNull()
    .references(() => notes.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Attachments — images only in v1. No embedding/indexing yet (no OCR/
// captioning) but the shape doesn't need to change when that lands later.
// ---------------------------------------------------------------------------
export const attachments = pgTable("attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  noteAppendId: uuid("note_append_id")
    .notNull()
    .references(() => noteAppends.id, { onDelete: "cascade" }),
  filePath: text("file_path").notNull(),
  mimeType: text("mime_type").notNull(),
  filename: text("filename").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Note tags — secondary (non-primary) domain links. A note has exactly one
// primary domain (notes.domainId) but can be tagged into others.
// ---------------------------------------------------------------------------
export const noteTags = pgTable("note_tags", {
  noteId: uuid("note_id")
    .notNull()
    .references(() => notes.id, { onDelete: "cascade" }),
  domainId: uuid("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
});

// ---------------------------------------------------------------------------
// Fragments — the capture inbox. A fragment is "pending" until resolved
// (routed into a note/domain/uncategorized) or deferred into the queue.
// ---------------------------------------------------------------------------
export const fragmentStatusEnum = pgEnum("fragment_status", [
  "pending",
  "queued",
  "resolved",
]);

export const fragments = pgTable("fragments", {
  id: uuid("id").primaryKey().defaultRandom(),
  contentType: contentTypeEnum("content_type").notNull().default("text"),
  content: text("content").notNull(),
  contentEmbedding: vector("content_embedding", {
    dimensions: EMBEDDING_DIM,
  }),
  status: fragmentStatusEnum("status").notNull().default("pending"),
  resolvedNoteId: uuid("resolved_note_id").references(() => notes.id, {
    onDelete: "set null",
  }),
  resolvedAppendId: uuid("resolved_append_id").references(
    () => noteAppends.id,
    { onDelete: "set null" }
  ),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Subfolder suggestions — generated by the periodic background job
// (>4 notes sharing a topic within a domain). Pending until accepted/rejected.
// ---------------------------------------------------------------------------
export const suggestionStatusEnum = pgEnum("suggestion_status", [
  "pending",
  "accepted",
  "rejected",
]);

export const subfolderSuggestions = pgTable("subfolder_suggestions", {
  id: uuid("id").primaryKey().defaultRandom(),
  domainId: uuid("domain_id")
    .notNull()
    .references(() => domains.id, { onDelete: "cascade" }),
  suggestedName: text("suggested_name").notNull(),
  noteIds: text("note_ids").notNull(), // JSON array of note UUIDs to move
  status: suggestionStatusEnum("status").notNull().default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ---------------------------------------------------------------------------
// Conversations & messages — backs both note-scoped and global chat.
// ---------------------------------------------------------------------------
export const conversationScopeEnum = pgEnum("conversation_scope", [
  "note",
  "global",
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").primaryKey().defaultRandom(),
  scope: conversationScopeEnum("scope").notNull(),
  noteId: uuid("note_id").references(() => notes.id, { onDelete: "cascade" }), // set when scope=note
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const messageRoleEnum = pgEnum("message_role", ["user", "assistant"]);

export const messages = pgTable("messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  conversationId: uuid("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: messageRoleEnum("role").notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});
