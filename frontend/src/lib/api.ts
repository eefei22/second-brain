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

export interface NoteMatch {
  noteId: string;
  title: string;
  score: number;
}

export async function listDomains(): Promise<Domain[]> {
  const res = await fetch(`${BASE}/domains`);
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
  target: { type: "note" | "domain" | "uncategorized"; note_id?: string; domain_id?: string }
) {
  const res = await fetch(`${BASE}/fragments/${fragmentId}/resolve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ target }),
  });
  return res.json() as Promise<{ note_id: string; append_id: string; suggested_title?: string }>;
}

export async function updateNoteTitle(noteId: string, title: string) {
  const res = await fetch(`${BASE}/notes/${noteId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  return res.json();
}

export async function deferFragment(fragmentId: string) {
  const res = await fetch(`${BASE}/fragments/${fragmentId}/defer`, { method: "POST" });
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
