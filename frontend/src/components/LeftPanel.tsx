import { useEffect, useState } from "react";
import { listDomains, listNotes, getQueue, search, type Domain, type NoteSummary } from "../lib/api.js";

export function LeftPanel({
  onOpenNote,
  refreshKey,
}: {
  onOpenNote: (noteId: string) => void;
  refreshKey: number;
}) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [notesByDomain, setNotesByDomain] = useState<Record<string, NoteSummary[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [queueCount, setQueueCount] = useState(0);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteSummary[] | null>(null);
  const [uncategorized, setUncategorized] = useState<NoteSummary[]>([]);

  // Top-level lists: fetched on mount, and re-fetched whenever refreshKey
  // bumps (i.e. a fragment was resolved/deferred elsewhere in the app).
  useEffect(() => {
    listDomains().then(setDomains);
    getQueue().then((q) => setQueueCount(q.length));
    listNotes({}).then((all) => setUncategorized(all.filter((n) => !n.domain_id)));
  }, [refreshKey]);

  // Any domain the user currently has expanded needs its notes re-fetched
  // too on refreshKey — otherwise a note captured while the domain was
  // already open (or captured earlier and never refetched since) never
  // shows up until a full page reload. This was the "second note doesn't
  // appear" bug: notesByDomain used to be populated once on first expand
  // and then cached forever.
  useEffect(() => {
    const openDomainIds = Object.keys(expanded).filter((id) => expanded[id]);
    if (openDomainIds.length === 0) return;
    Promise.all(openDomainIds.map((id) => listNotes({ domain_id: id }))).then((results) => {
      setNotesByDomain((prev) => {
        const next = { ...prev };
        openDomainIds.forEach((id, i) => {
          next[id] = results[i];
        });
        return next;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  async function toggleDomain(domainId: string) {
    setExpanded((e) => ({ ...e, [domainId]: !e[domainId] }));
    if (!notesByDomain[domainId]) {
      const notes = await listNotes({ domain_id: domainId });
      setNotesByDomain((n) => ({ ...n, [domainId]: notes }));
    }
  }

  async function runSearch(q: string) {
    setQuery(q);
    if (!q) return setSearchResults(null);
    setSearchResults(await search(q));
  }

  return (
    <div className="h-full flex flex-col bg-neutral-800 border-r border-neutral-700 text-sm">
      <div className="p-3 border-b border-neutral-700 space-y-2">
        <input
          value={query}
          onChange={(e) => runSearch(e.target.value)}
          placeholder="Search notes..."
          className="w-full px-2 py-1.5 rounded-md bg-neutral-900 border border-neutral-700 text-cream placeholder:text-cream-dim/50 text-sm focus:outline-none focus:ring-2 focus:ring-cream/40"
        />
        {queueCount > 0 && (
          <button className="w-full flex items-center justify-between px-2 py-1.5 rounded-md bg-amber-900/40 text-amber-200 hover:bg-amber-900/60 transition">
            <span>Inbox</span>
            <span className="rounded-full bg-amber-700/60 px-2 text-xs font-medium">{queueCount}</span>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {searchResults ? (
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-wide text-cream-dim px-2 py-1">Results</div>
            {searchResults.map((n) => (
              <NoteRow key={n.note_id} note={n} onClick={() => onOpenNote(n.note_id)} />
            ))}
          </div>
        ) : (
          <>
            {domains.map((d) => (
              <div key={d.id} className="mb-1">
                <button
                  onClick={() => toggleDomain(d.id)}
                  className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-neutral-700 font-medium text-cream transition"
                >
                  <span className="text-cream-dim text-xs w-3">{expanded[d.id] ? "▾" : "▸"}</span>
                  {d.name}
                </button>
                {expanded[d.id] && (
                  <div className="ml-4 space-y-0.5">
                    {(notesByDomain[d.id] ?? []).map((n) => (
                      <NoteRow key={n.note_id} note={n} onClick={() => onOpenNote(n.note_id)} />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {uncategorized.length > 0 && (
              <div className="mt-3 pt-3 border-t border-neutral-700">
                <div className="text-xs uppercase tracking-wide text-cream-dim px-2 py-1">Uncategorized</div>
                {uncategorized.map((n) => (
                  <NoteRow key={n.note_id} note={n} onClick={() => onOpenNote(n.note_id)} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function NoteRow({ note, onClick }: { note: NoteSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-1.5 rounded-md hover:bg-neutral-700 text-cream-dim truncate transition"
    >
      {note.title}
    </button>
  );
}
