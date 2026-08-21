import { useEffect, useRef, useState } from "react";
import {
  listDomains,
  listNotes,
  listSubfolders,
  getQueue,
  search,
  createDomain,
  renameDomain,
  deleteDomain,
  createSubfolder,
  updateSubfolder,
  deleteSubfolder,
  createNote,
  updateNote,
  deleteNote,
  type Domain,
  type Subfolder,
  type NoteSummary,
} from "../lib/api.js";

// What the open context menu is pointing at, and where to render it.
type MenuTarget =
  | { kind: "domain"; domain: Domain }
  | { kind: "subfolder"; subfolder: Subfolder }
  | { kind: "note"; note: NoteSummary };

interface MenuState {
  target: MenuTarget;
  x: number;
  y: number;
  mode: "actions" | "move"; // "move" swaps the menu body to a domain picker
}

// Custom name/confirm modal — NOT window.prompt()/confirm(). Native dialogs
// turned out unreliable here: Chrome lets a page's dialogs get silently,
// permanently suppressed via the "Prevent this page from creating
// additional dialogs" checkbox, which is easy to trigger by accident while
// clicking through several menu actions — after that every prompt()/
// confirm() call just returns null/false with no visible sign anything
// happened. This has no such failure mode.
type DialogState =
  | { kind: "prompt"; title: string; defaultValue?: string; onConfirm: (value: string) => void }
  | { kind: "confirm"; title: string; message: string; danger?: boolean; onConfirm: () => void };

export function LeftPanel({
  onOpenNote,
  refreshKey,
}: {
  onOpenNote: (noteId: string) => void;
  refreshKey: number;
}) {
  const [domains, setDomains] = useState<Domain[]>([]);
  const [expandedDomains, setExpandedDomains] = useState<Record<string, boolean>>({});
  const [domainSubfolders, setDomainSubfolders] = useState<Record<string, Subfolder[]>>({});
  const [domainRootNotes, setDomainRootNotes] = useState<Record<string, NoteSummary[]>>({});
  const [expandedSubfolders, setExpandedSubfolders] = useState<Record<string, boolean>>({});
  const [subfolderNotes, setSubfolderNotes] = useState<Record<string, NoteSummary[]>>({});
  const [queueCount, setQueueCount] = useState(0);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteSummary[] | null>(null);
  const [uncategorized, setUncategorized] = useState<NoteSummary[]>([]);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [dialog, setDialog] = useState<DialogState | null>(null);

  useEffect(() => {
    refreshTop();
    // Re-fetch anything currently expanded too, so edits made elsewhere
    // (e.g. the capture flow) show up without a manual re-expand.
    Object.keys(expandedDomains)
      .filter((id) => expandedDomains[id])
      .forEach(loadDomainContents);
    Object.keys(expandedSubfolders)
      .filter((id) => expandedSubfolders[id])
      .forEach(loadSubfolderNotes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  // Close the context menu on any outside click or Escape.
  useEffect(() => {
    if (!menu) return;
    function close() {
      setMenu(null);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenu(null);
    }
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  function refreshTop() {
    listDomains().then(setDomains);
    getQueue().then((q) => setQueueCount(q.length));
    listNotes({}).then((all) => setUncategorized(all.filter((n) => !n.domain_id)));
  }

  async function loadDomainContents(domainId: string) {
    const [subs, rootNotes] = await Promise.all([
      listSubfolders(domainId),
      listNotes({ domain_id: domainId }),
    ]);
    setDomainSubfolders((s) => ({ ...s, [domainId]: subs }));
    setDomainRootNotes((n) => ({ ...n, [domainId]: rootNotes }));
  }

  async function loadSubfolderNotes(subfolderId: string) {
    const notes = await listNotes({ parent_folder_id: subfolderId });
    setSubfolderNotes((n) => ({ ...n, [subfolderId]: notes }));
  }

  async function toggleDomain(domainId: string) {
    const nowOpen = !expandedDomains[domainId];
    setExpandedDomains((e) => ({ ...e, [domainId]: nowOpen }));
    if (nowOpen) await loadDomainContents(domainId);
  }

  async function toggleSubfolder(subfolderId: string) {
    const nowOpen = !expandedSubfolders[subfolderId];
    setExpandedSubfolders((e) => ({ ...e, [subfolderId]: nowOpen }));
    if (nowOpen) await loadSubfolderNotes(subfolderId);
  }

  async function runSearch(q: string) {
    setQuery(q);
    if (!q) return setSearchResults(null);
    setSearchResults(await search(q));
  }

  function openMenu(e: React.MouseEvent, target: MenuTarget) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ target, x: e.clientX, y: e.clientY, mode: "actions" });
  }

  // --- Actions ---------------------------------------------------------

  function handleNewDomain() {
    setDialog({
      kind: "prompt",
      title: "New domain name",
      onConfirm: async (name) => {
        if (!name.trim()) return;
        await createDomain(name.trim());
        refreshTop();
      },
    });
  }

  function handleRenameDomain(domain: Domain) {
    setDialog({
      kind: "prompt",
      title: "Rename domain",
      defaultValue: domain.name,
      onConfirm: async (name) => {
        if (!name.trim() || name.trim() === domain.name) return;
        await renameDomain(domain.id, name.trim());
        refreshTop();
      },
    });
  }

  function handleDeleteDomain(domain: Domain) {
    setDialog({
      kind: "confirm",
      title: "Delete domain",
      message: `Delete "${domain.name}"? Its notes will become Uncategorized, not deleted.`,
      danger: true,
      onConfirm: async () => {
        await deleteDomain(domain.id);
        refreshTop();
      },
    });
  }

  function handleNewSubfolder(domainId: string) {
    setDialog({
      kind: "prompt",
      title: "New subfolder name",
      onConfirm: async (name) => {
        if (!name.trim()) return;
        await createSubfolder(domainId, name.trim());
        await loadDomainContents(domainId);
        if (!expandedDomains[domainId]) setExpandedDomains((e) => ({ ...e, [domainId]: true }));
      },
    });
  }

  function handleRenameSubfolder(sub: Subfolder) {
    setDialog({
      kind: "prompt",
      title: "Rename subfolder",
      defaultValue: sub.name,
      onConfirm: async (name) => {
        if (!name.trim() || name.trim() === sub.name) return;
        await updateSubfolder(sub.id, { name: name.trim() });
        await loadDomainContents(sub.domainId);
      },
    });
  }

  function handleDeleteSubfolder(sub: Subfolder) {
    setDialog({
      kind: "confirm",
      title: "Delete subfolder",
      message: `Delete "${sub.name}"? Its notes move to the domain root, not deleted.`,
      danger: true,
      onConfirm: async () => {
        await deleteSubfolder(sub.id);
        await loadDomainContents(sub.domainId);
      },
    });
  }

  async function handleMoveSubfolder(sub: Subfolder, newDomainId: string) {
    const oldDomainId = sub.domainId;
    await updateSubfolder(sub.id, { domain_id: newDomainId });
    await loadDomainContents(oldDomainId);
    if (expandedDomains[newDomainId]) await loadDomainContents(newDomainId);
    setMenu(null);
  }

  function handleNewNote(domainId: string, parentFolderId: string | null) {
    setDialog({
      kind: "prompt",
      title: "New note title",
      onConfirm: async (title) => {
        if (!title.trim()) return;
        await createNote({ title: title.trim(), domain_id: domainId, parent_folder_id: parentFolderId });
        if (parentFolderId) await loadSubfolderNotes(parentFolderId);
        else await loadDomainContents(domainId);
      },
    });
  }

  function handleRenameNote(note: NoteSummary) {
    setDialog({
      kind: "prompt",
      title: "Rename note",
      defaultValue: note.title,
      onConfirm: async (title) => {
        if (!title.trim() || title.trim() === note.title) return;
        await updateNote(note.note_id, { title: title.trim() });
        refreshNoteLocation(note);
      },
    });
  }

  function handleDeleteNote(note: NoteSummary) {
    setDialog({
      kind: "confirm",
      title: "Delete note",
      message: `Delete "${note.title}"? It can be restored later (soft delete).`,
      danger: true,
      onConfirm: async () => {
        await deleteNote(note.note_id);
        refreshNoteLocation(note);
        refreshTop();
      },
    });
  }

  async function handleMoveNote(
    note: NoteSummary,
    newDomainId: string | null,
    newParentFolderId: string | null = null
  ) {
    await updateNote(note.note_id, { domain_id: newDomainId, parent_folder_id: newParentFolderId });
    refreshNoteLocation(note);
    if (newParentFolderId && expandedSubfolders[newParentFolderId]) await loadSubfolderNotes(newParentFolderId);
    else if (newDomainId && expandedDomains[newDomainId]) await loadDomainContents(newDomainId);
    if (!newDomainId) refreshTop();
    setMenu(null);
  }

  // Re-fetch wherever a note used to live, after renaming/deleting/moving it.
  function refreshNoteLocation(note: NoteSummary) {
    if (note.parent_folder_id) loadSubfolderNotes(note.parent_folder_id);
    else if (note.domain_id) loadDomainContents(note.domain_id);
    else refreshTop();
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
        <button
          onClick={handleNewDomain}
          className="w-full text-left px-2 py-1 text-xs text-cream-dim hover:text-cream transition"
        >
          + New domain
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {searchResults ? (
          <div className="space-y-0.5">
            <div className="text-xs uppercase tracking-wide text-cream-dim px-2 py-1">Results</div>
            {searchResults.map((n) => (
              <NoteRow
                key={n.note_id}
                note={n}
                onClick={() => onOpenNote(n.note_id)}
                onMenu={(e) => openMenu(e, { kind: "note", note: n })}
              />
            ))}
          </div>
        ) : (
          <>
            {domains.map((d) => (
              <div key={d.id} className="mb-1">
                <Row
                  label={d.name}
                  bold
                  expanded={expandedDomains[d.id]}
                  onClick={() => toggleDomain(d.id)}
                  onMenu={(e) => openMenu(e, { kind: "domain", domain: d })}
                />
                {expandedDomains[d.id] && (
                  <div className="ml-4 space-y-0.5">
                    {(domainSubfolders[d.id] ?? []).map((sub) => (
                      <div key={sub.id}>
                        <Row
                          label={sub.name}
                          icon="📁"
                          expanded={expandedSubfolders[sub.id]}
                          onClick={() => toggleSubfolder(sub.id)}
                          onMenu={(e) => openMenu(e, { kind: "subfolder", subfolder: sub })}
                        />
                        {expandedSubfolders[sub.id] && (
                          <div className="ml-4 space-y-0.5">
                            {(subfolderNotes[sub.id] ?? []).map((n) => (
                              <NoteRow
                                key={n.note_id}
                                note={n}
                                onClick={() => onOpenNote(n.note_id)}
                                onMenu={(e) => openMenu(e, { kind: "note", note: n })}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                    {(domainRootNotes[d.id] ?? []).map((n) => (
                      <NoteRow
                        key={n.note_id}
                        note={n}
                        onClick={() => onOpenNote(n.note_id)}
                        onMenu={(e) => openMenu(e, { kind: "note", note: n })}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}

            {uncategorized.length > 0 && (
              <div className="mt-3 pt-3 border-t border-neutral-700">
                <div className="text-xs uppercase tracking-wide text-cream-dim px-2 py-1">Uncategorized</div>
                {uncategorized.map((n) => (
                  <NoteRow
                    key={n.note_id}
                    note={n}
                    onClick={() => onOpenNote(n.note_id)}
                    onMenu={(e) => openMenu(e, { kind: "note", note: n })}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {menu && (
        <ContextMenu
          menu={menu}
          domains={domains}
          onClose={() => setMenu(null)}
          onShowMove={() => setMenu((m) => (m ? { ...m, mode: "move" } : m))}
          onNewSubfolder={(domainId) => {
            setMenu(null);
            handleNewSubfolder(domainId);
          }}
          onNewNote={(domainId, parentFolderId) => {
            setMenu(null);
            handleNewNote(domainId, parentFolderId);
          }}
          onRenameDomain={(d) => {
            setMenu(null);
            handleRenameDomain(d);
          }}
          onDeleteDomain={(d) => {
            setMenu(null);
            handleDeleteDomain(d);
          }}
          onRenameSubfolder={(s) => {
            setMenu(null);
            handleRenameSubfolder(s);
          }}
          onDeleteSubfolder={(s) => {
            setMenu(null);
            handleDeleteSubfolder(s);
          }}
          onMoveSubfolder={handleMoveSubfolder}
          onRenameNote={(n) => {
            setMenu(null);
            handleRenameNote(n);
          }}
          onDeleteNote={(n) => {
            setMenu(null);
            handleDeleteNote(n);
          }}
          onMoveNote={handleMoveNote}
        />
      )}

      {dialog && <Dialog state={dialog} onClose={() => setDialog(null)} />}
    </div>
  );
}

// --- Shared row + menu components ---------------------------------------

function Row({
  label,
  icon,
  bold,
  expanded,
  onClick,
  onMenu,
}: {
  label: string;
  icon?: string;
  bold?: boolean;
  expanded?: boolean;
  onClick: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="group w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-neutral-700 transition cursor-pointer"
      onClick={onClick}
      onContextMenu={onMenu}
    >
      <span className="text-cream-dim text-xs w-3">{expanded ? "▾" : "▸"}</span>
      {icon && <span className="text-xs">{icon}</span>}
      <span className={`flex-1 truncate ${bold ? "font-medium text-cream" : "text-cream-dim"}`}>{label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e);
        }}
        className="opacity-0 group-hover:opacity-100 text-cream-dim hover:text-cream px-1 transition"
      >
        ⋮
      </button>
    </div>
  );
}

function NoteRow({
  note,
  onClick,
  onMenu,
}: {
  note: NoteSummary;
  onClick: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="group w-full flex items-center px-2 py-1.5 rounded-md hover:bg-neutral-700 transition cursor-pointer"
      onClick={onClick}
      onContextMenu={onMenu}
    >
      <span className="flex-1 truncate text-cream-dim">{note.title}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onMenu(e);
        }}
        className="opacity-0 group-hover:opacity-100 text-cream-dim hover:text-cream px-1 transition"
      >
        ⋮
      </button>
    </div>
  );
}

function ContextMenu({
  menu,
  domains,
  onClose,
  onShowMove,
  onNewSubfolder,
  onNewNote,
  onRenameDomain,
  onDeleteDomain,
  onRenameSubfolder,
  onDeleteSubfolder,
  onMoveSubfolder,
  onRenameNote,
  onDeleteNote,
  onMoveNote,
}: {
  menu: MenuState;
  domains: Domain[];
  onClose: () => void;
  onShowMove: () => void;
  onNewSubfolder: (domainId: string) => void;
  onNewNote: (domainId: string, parentFolderId: string | null) => void;
  onRenameDomain: (d: Domain) => void;
  onDeleteDomain: (d: Domain) => void;
  onRenameSubfolder: (s: Subfolder) => void;
  onDeleteSubfolder: (s: Subfolder) => void;
  onMoveSubfolder: (s: Subfolder, newDomainId: string) => void;
  onRenameNote: (n: NoteSummary) => void;
  onDeleteNote: (n: NoteSummary) => void;
  onMoveNote: (n: NoteSummary, newDomainId: string | null, newParentFolderId?: string | null) => void;
}) {
  // Clamp so the menu never renders off the right/bottom edge.
  const style = { left: Math.min(menu.x, window.innerWidth - 200), top: Math.min(menu.y, window.innerHeight - 200) };
  // Narrowing `target.kind` doesn't persist into the onClick closures below
  // if we keep reading menu.target (a property access) — a local const does.
  const target = menu.target;

  return (
    <div
      className="fixed z-50 min-w-[180px] rounded-md border border-neutral-600 bg-neutral-800 shadow-xl py-1 text-sm"
      style={style}
      onClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {menu.mode === "move" ? (
        <>
          <div className="px-3 py-1 text-xs uppercase tracking-wide text-cream-dim/70">Move to</div>
          {domains
            .filter((d) => {
              if (target.kind === "subfolder") return d.id !== target.subfolder.domainId;
              if (target.kind === "note") return d.id !== target.note.domain_id;
              return true;
            })
            .map((d) => {
              if (target.kind === "note") {
                return (
                  <MoveDomainRow
                    key={d.id}
                    domain={d}
                    onMoveToDomain={() => onMoveNote(target.note, d.id)}
                    onMoveToSubfolder={(subfolderId) => onMoveNote(target.note, d.id, subfolderId)}
                  />
                );
              }
              if (target.kind === "subfolder") {
                return <MenuItem key={d.id} label={d.name} onClick={() => onMoveSubfolder(target.subfolder, d.id)} />;
              }
              return null;
            })}
          {target.kind === "note" && target.note.domain_id && (
            <MenuItem label="Uncategorized" onClick={() => onMoveNote(target.note, null)} />
          )}
        </>
      ) : target.kind === "domain" ? (
        <>
          <MenuItem label="New Subfolder" onClick={() => onNewSubfolder(target.domain.id)} />
          <MenuItem label="New Note" onClick={() => onNewNote(target.domain.id, null)} />
          <MenuItem label="Rename" onClick={() => onRenameDomain(target.domain)} />
          <MenuItem label="Delete" danger onClick={() => onDeleteDomain(target.domain)} />
        </>
      ) : target.kind === "subfolder" ? (
        <>
          <MenuItem
            label="New Note"
            onClick={() => onNewNote(target.subfolder.domainId, target.subfolder.id)}
          />
          <MenuItem label="Rename" onClick={() => onRenameSubfolder(target.subfolder)} />
          <MenuItem label="Move to..." onClick={onShowMove} />
          <MenuItem label="Delete" danger onClick={() => onDeleteSubfolder(target.subfolder)} />
        </>
      ) : (
        <>
          <MenuItem label="Rename" onClick={() => onRenameNote(target.note)} />
          <MenuItem label="Move to..." onClick={onShowMove} />
          <MenuItem label="Delete" danger onClick={() => onDeleteNote(target.note)} />
        </>
      )}
      <div className="border-t border-neutral-700 mt-1 pt-1">
        <MenuItem label="Cancel" muted onClick={onClose} />
      </div>
    </div>
  );
}

// One row in the "Move to" list for a note — clicking the name moves the
// note to that domain's root; the chevron expands to show the domain's
// subfolders (lazy-loaded on first expand) as direct move targets too.
function MoveDomainRow({
  domain,
  onMoveToDomain,
  onMoveToSubfolder,
}: {
  domain: Domain;
  onMoveToDomain: () => void;
  onMoveToSubfolder: (subfolderId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [subs, setSubs] = useState<Subfolder[] | null>(null);

  async function toggle(e: React.MouseEvent) {
    e.stopPropagation();
    if (!expanded && subs === null) setSubs(await listSubfolders(domain.id));
    setExpanded((v) => !v);
  }

  return (
    <div>
      <div className="w-full flex items-center hover:bg-neutral-700 transition">
        <button onClick={toggle} className="px-2 py-1.5 text-cream-dim/50 hover:text-cream w-6 text-center">
          {expanded ? "▾" : "▸"}
        </button>
        <button onClick={onMoveToDomain} className="flex-1 text-left py-1.5 pr-3 text-cream-dim hover:text-cream">
          {domain.name}
        </button>
      </div>
      {expanded && (
        <div className="ml-5">
          {subs === null ? (
            <div className="px-3 py-1 text-xs text-cream-dim/50">Loading...</div>
          ) : subs.length === 0 ? (
            <div className="px-3 py-1 text-xs text-cream-dim/50">No subfolders</div>
          ) : (
            subs.map((s) => <MenuItem key={s.id} label={s.name} onClick={() => onMoveToSubfolder(s.id)} />)
          )}
        </div>
      )}
    </div>
  );
}

function MenuItem({
  label,
  onClick,
  danger,
  muted,
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
  muted?: boolean;
}) {
  const color = danger ? "text-red-400 hover:bg-red-950/40" : muted ? "text-cream-dim/60 hover:bg-neutral-700" : "text-cream-dim hover:bg-neutral-700 hover:text-cream";
  return (
    <button onClick={onClick} className={`w-full text-left px-3 py-1.5 transition ${color}`}>
      {label}
    </button>
  );
}

function Dialog({ state, onClose }: { state: DialogState; onClose: () => void }) {
  const [value, setValue] = useState(state.kind === "prompt" ? state.defaultValue ?? "" : "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function submit() {
    if (state.kind === "prompt") {
      if (!value.trim()) return; // empty name — just close, same as cancelling
      state.onConfirm(value);
    } else {
      state.onConfirm();
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={onClose}
      onKeyDown={(e) => e.key === "Escape" && onClose()}
    >
      <div
        className="bg-neutral-800 border border-neutral-600 rounded-lg shadow-xl p-4 w-80"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="text-cream font-medium mb-2">{state.title}</div>
        {state.kind === "confirm" && <div className="text-cream-dim text-sm mb-4">{state.message}</div>}
        {state.kind === "prompt" && (
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submit();
            }}
            className="w-full px-2 py-1.5 rounded-md bg-neutral-900 border border-neutral-700 text-cream text-sm mb-4 focus:outline-none focus:ring-2 focus:ring-cream/40"
          />
        )}
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded-md text-sm text-cream-dim hover:bg-neutral-700 transition"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition ${
              state.kind === "confirm" && state.danger
                ? "bg-red-600 text-white hover:bg-red-500"
                : "bg-cream text-neutral-900 hover:bg-cream/90"
            }`}
          >
            {state.kind === "confirm" ? "Delete" : "OK"}
          </button>
        </div>
      </div>
    </div>
  );
}
