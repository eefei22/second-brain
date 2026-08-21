const BASE = import.meta.env.VITE_API_URL ?? "http://localhost:4000";

export interface NoteSummary {
  note_id: string;
  title: string;
  domain_id: string | null;
  parent_folder_id: string | null;
  updated_at: string;
}

export interface Domain {
  id: string;
  name: string;
}

export interface Subfolder {
  id: string;
  domainId: string;
  name: string;
}

export interface NoteMatch {
  noteId: string;
  title: string;
  score: number;
}

export async function listDomains(): Promise<Domain[]> {
  const res = await fetch(`${BASE}/domains`);
  return res.json();
}

export async function createDomain(name: string): Promise<Domain> {
  const res = await fetch(`${BASE}/domains`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function renameDomain(id: string, name: string): Promise<Domain> {
  const res = await fetch(`${BASE}/domains/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function deleteDomain(id: string) {
  const res = await fetch(`${BASE}/domains/${id}`, { method: "DELETE" });
  return res.json();
}

export async function listSubfolders(domainId: string): Promise<Subfolder[]> {
  const res = await fetch(`${BASE}/domains/${domainId}/subfolders`);
  return res.json();
}

export async function createSubfolder(domainId: string, name: string): Promise<Subfolder> {
  const res = await fetch(`${BASE}/domains/${domainId}/subfolders`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function updateSubfolder(
  id: string,
  patch: { name?: string; domain_id?: string }
): Promise<Subfolder> {
  const res = await fetch(`${BASE}/subfolders/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function deleteSubfolder(id: string) {
  const res = await fetch(`${BASE}/subfolders/${id}`, { method: "DELETE" });
  return res.json();
}

export async function createNote(params: {
  title: string;
  domain_id?: string | null;
  parent_folder_id?: string | null;
}) {
  const res = await fetch(`${BASE}/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

export async function updateNote(
  id: string,
  patch: { title?: string; domain_id?: string | null; parent_folder_id?: string | null }
) {
  const res = await fetch(`${BASE}/notes/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  return res.json();
}

export async function deleteNote(id: string) {
  const res = await fetch(`${BASE}/notes/${id}`, { method: "DELETE" });
  return res.json();
}

export async function listNotes(params: {
  domain_id?: string;
  parent_folder_id?: string;
}): Promise<NoteSummary[]> {
  const qs = new URLSearchParams(params as Record<string, string>).toString();
  const res = await fetch(`${BASE}/notes?${qs}`);
  return res.json();
}

export async function getNote(id: string) {
  const res = await fetch(`${BASE}/notes/${id}`);
  return res.json();
}

export async function submitFragment(content: string, type: "text" | "image" = "text") {
  const res = await fetch(`${BASE}/fragments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, type }),
  });
  return res.json() as Promise<{ fragment_id: string; status: string }>;
}

export async function getDomainMatches(fragmentId: string, domainId: string) {
  const res = await fetch(
    `${BASE}/fragments/${fragmentId}/domain-matches?domain_id=${encodeURIComponent(domainId)}`
  );
  return res.json() as Promise<{ notes: NoteMatch[] }>;
}

export async function resolveFragment(
  fragmentId: string,
  target: {
    type: "note" | "domain" | "uncategorized";
    note_id?: string;
    domain_id?: string;
    parent_folder_id?: string;
  }
) {
  const res = await fetch(`${BASE}/fragments/${fragmentId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  return res.json() as Promise<{ note_id: string; append_id: string; suggested_title?: string }>;
}

export async function updateNoteTitle(noteId: string, title: string) {
  return updateNote(noteId, { title });
}

export async function deferFragment(fragmentId: string) {
  const res = await fetch(`${BASE}/fragments/${fragmentId}/defer`, { method: "POST" });
  return res.json();
}

export async function cancelFragment(fragmentId: string) {
  const res = await fetch(`${BASE}/fragments/${fragmentId}`, { method: "DELETE" });
  return res.json();
}

export async function getQueue() {
  const res = await fetch(`${BASE}/fragments/queue`);
  return res.json();
}

export async function search(q: string) {
  const res = await fetch(`${BASE}/search?q=${encodeURIComponent(q)}`);
  return res.json();
}

export async function formatText(text: string, instructions?: string) {
  const res = await fetch(`${BASE}/format`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, instructions }),
  });
  return res.json() as Promise<{ formatted: string }>;
}
