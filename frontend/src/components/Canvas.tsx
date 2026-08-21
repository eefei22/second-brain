import { useEffect, useRef, useState } from "react";
import {
  submitFragment,
  resolveFragment,
  deferFragment,
  updateNoteTitle,
  listDomains,
  listSubfolders,
  getDomainMatches,
  formatText,
  type Domain,
  type Subfolder,
  type NoteMatch,
} from "../lib/api.js";
import { Markdown } from "./Markdown.js";

interface TitleSuggestion {
  noteId: string;
  oldTitle?: string;
  newTitle: string;
}

// Capture UX v2 — two-step routing instead of one flat suggestion list:
//   1. "domain" stage — fixed, unscored list of all domains (picking one
//      scopes the note-matching search, per request — a deliberate reversal
//      of the requirements doc's original "autonomous, no pre-scoping"
//      design; matching.ts's corpus-wide getSuggestions() is now only used
//      by the not-yet-built queue-resolution UI).
//   2. "note" stage — ranked "Continue: ..." candidates *within* that domain
//      (top 7, no similarity floor — the user already committed to the
//      domain), then fixed slots: 8 New Note, 9 Resolve later, 0 Uncategorized.
//   3. "subfolder" stage — only entered from "New Note" when the chosen
//      domain actually has subfolders; picks where in the domain the new
//      note lands (root or a specific subfolder). Skipped entirely (straight
//      to creating the note at the domain root) for domains with none.
type Stage = "idle" | "domain" | "note" | "subfolder";

// Inline AI formatter (separate from the domain/note/subfolder capture
// stages above — only ever active while stage === "idle", before capture).
// "input" -> "loading" -> "preview", where preview replaces the main canvas
// view with the formatted result until Applied or Discarded (never
// overwrites the draft directly, per the same preview-first pattern as
// title re-suggestion and the Polish action).
type FormatPhase = "closed" | "input" | "loading" | "preview";

export function Canvas({ onChanged }: { onChanged?: () => void }) {
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [fragmentId, setFragmentId] = useState<string | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [domains, setDomains] = useState<Domain[]>([]);
  const [chosenDomainId, setChosenDomainId] = useState<string | null>(null);
  const [noteMatches, setNoteMatches] = useState<NoteMatch[] | null>(null);
  const [subfolders, setSubfolders] = useState<Subfolder[] | null>(null);
  const [titleSuggestion, setTitleSuggestion] = useState<TitleSuggestion | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [formatPhase, setFormatPhase] = useState<FormatPhase>("closed");
  const [formatInstructions, setFormatInstructions] = useState("");
  const [formatResult, setFormatResult] = useState<string | null>(null);

  useEffect(() => {
    listDomains().then(setDomains);
  }, []);

  function showToast(message: string) {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(message);
    toastTimer.current = setTimeout(() => setToast(null), 2200);
  }

  async function handleSave() {
    if (!text.trim()) return;
    setTitleSuggestion(null);
    setPreview(false);
    cancelFormat();
    const result = await submitFragment(text);
    setFragmentId(result.fragment_id);
    setStage("domain");
  }

  async function chooseDomain(domainId: string) {
    if (!fragmentId) return;
    setChosenDomainId(domainId);
    setNoteMatches(null);
    setSubfolders(null);
    setStage("note");
    const [{ notes }, subs] = await Promise.all([
      getDomainMatches(fragmentId, domainId),
      listSubfolders(domainId),
    ]);
    setNoteMatches(notes);
    setSubfolders(subs);
  }

  // "New Note" — only domains with subfolders get an extra stop to pick
  // where in the domain the note lands; otherwise straight to the root.
  function handleNewNoteClick() {
    if (!chosenDomainId) return;
    if (subfolders && subfolders.length > 0) {
      setStage("subfolder");
    } else {
      handleResolve({ type: "domain", domain_id: chosenDomainId });
    }
  }

  async function handleResolve(target: {
    type: "note" | "domain" | "uncategorized";
    note_id?: string;
    domain_id?: string;
    parent_folder_id?: string;
  }) {
    if (!fragmentId) return;
    const oldTitle = noteMatches?.find((n) => n.noteId === target.note_id)?.title;
    const result = await resolveFragment(fragmentId, target);
    reset();
    onChanged?.();
    showToast(target.type === "note" ? "Added to note" : "Note saved");
    if (result.suggested_title && target.type === "note" && target.note_id) {
      setTitleSuggestion({ noteId: target.note_id, oldTitle, newTitle: result.suggested_title });
    }
  }

  async function handleDefer() {
    if (!fragmentId) return;
    await deferFragment(fragmentId);
    reset();
    onChanged?.();
    showToast("Saved to inbox");
  }

  async function applyTitleSuggestion() {
    if (!titleSuggestion) return;
    await updateNoteTitle(titleSuggestion.noteId, titleSuggestion.newTitle);
    setTitleSuggestion(null);
    onChanged?.();
  }

  function reset() {
    setText("");
    setFragmentId(null);
    setStage("idle");
    setChosenDomainId(null);
    setNoteMatches(null);
    setSubfolders(null);
    cancelFormat();
  }

  function cancelFormat() {
    setFormatPhase("closed");
    setFormatInstructions("");
    setFormatResult(null);
  }

  async function runFormat() {
    if (!text.trim()) return;
    setFormatPhase("loading");
    const { formatted } = await formatText(text, formatInstructions);
    setFormatResult(formatted);
    setFormatPhase("preview");
  }

  function applyFormat() {
    if (formatResult === null) return;
    setText(formatResult);
    setPreview(true); // show the newly-applied markdown rendered, not raw
    cancelFormat();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if ((e.metaKey || e.ctrlKey) && e.key === "s") {
      e.preventDefault();
      handleSave();
    } else if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "f") {
      // Plain Ctrl+F is the browser's reserved find-in-page shortcut —
      // pages can't override it (Chrome ignores preventDefault on it), so
      // this needs the extra Shift to actually be interceptable.
      if (formatPhase === "closed" && text.trim()) {
        e.preventDefault();
        setFormatPhase("input");
      }
    }
  }

  // Numeric shortcuts, meaning depends on which stage is showing.
  useEffect(() => {
    if (stage === "idle") return;
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (!/^[0-9]$/.test(e.key)) return;
      const n = Number(e.key);

      if (stage === "domain") {
        if (n < 1 || n > domains.length) return;
        e.preventDefault();
        chooseDomain(domains[n - 1].id);
        return;
      }

      if (stage === "subfolder") {
        if (!chosenDomainId || subfolders === null) return;
        if (n === 1) {
          e.preventDefault();
          handleResolve({ type: "domain", domain_id: chosenDomainId });
        } else if (n >= 2 && n <= subfolders.length + 1) {
          e.preventDefault();
          handleResolve({
            type: "domain",
            domain_id: chosenDomainId,
            parent_folder_id: subfolders[n - 2].id,
          });
        }
        return;
      }

      // stage === "note"
      if (noteMatches === null) return; // still loading — ignore keys
      if (n >= 1 && n <= 7 && n <= noteMatches.length) {
        e.preventDefault();
        handleResolve({ type: "note", note_id: noteMatches[n - 1].noteId });
      } else if (n === 8) {
        e.preventDefault();
        handleNewNoteClick();
      } else if (n === 9) {
        e.preventDefault();
        handleDefer();
      } else if (n === 0) {
        e.preventDefault();
        handleResolve({ type: "uncategorized" });
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage, domains, noteMatches, subfolders, chosenDomainId]);

  return (
    <div className="h-full flex flex-col bg-neutral-900 relative">
      {toast && (
        <div className="absolute top-4 left-1/2 z-10 px-4 py-1.5 rounded-full bg-cream text-neutral-900 text-sm font-medium shadow-lg animate-fadeIn">
          {toast}
        </div>
      )}

      {stage === "idle" && text.trim().length > 0 && (
        <div className="absolute top-3 right-4 z-10 flex items-center gap-2">
          {formatPhase === "closed" && (
            <button
              onClick={() => setFormatPhase("input")}
              title="Ctrl+Shift+F"
              className="px-2.5 py-1 rounded-full border border-neutral-700 text-xs font-medium text-cream-dim hover:bg-neutral-800 hover:text-cream transition"
            >
              ✨ Format with AI <span className="text-cream-dim/50">Ctrl+Shift+F</span>
            </button>
          )}
          <div className="flex rounded-full border border-neutral-700 overflow-hidden text-xs">
            <button
              onClick={() => setPreview(false)}
              className={`px-2.5 py-1 font-medium transition ${!preview ? "bg-cream text-neutral-900" : "text-cream-dim hover:bg-neutral-800"}`}
            >
              Write
            </button>
            <button
              onClick={() => setPreview(true)}
              className={`px-2.5 py-1 font-medium transition ${preview ? "bg-cream text-neutral-900" : "text-cream-dim hover:bg-neutral-800"}`}
            >
              Preview
            </button>
          </div>
        </div>
      )}

      {/* min-h-0 stops the flex child from growing to fit the textarea's
          content (a flexbox default-quirk) — without it this wrapper also
          became scrollable, stacking a second scrollbar on top of the
          textarea's own native one. */}
      <div className="flex-1 p-8 min-h-0">
        {formatPhase === "preview" && formatResult !== null ? (
          <div className="w-full h-full overflow-y-auto text-cream text-base leading-relaxed">
            <Markdown>{formatResult}</Markdown>
          </div>
        ) : preview && stage === "idle" ? (
          <div className="w-full h-full overflow-y-auto text-cream text-base leading-relaxed">
            <Markdown>{text}</Markdown>
          </div>
        ) : (
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            disabled={stage !== "idle" || formatPhase === "loading"}
            placeholder="Write whatever you want. ⌘S / Ctrl+S to save."
            className="w-full h-full resize-none focus:outline-none bg-transparent text-cream placeholder:text-cream-dim/50 text-base leading-relaxed disabled:opacity-60"
          />
        )}
      </div>

      {stage === "domain" && (
        <div className="border-t border-neutral-700 p-4 bg-neutral-800 space-y-2">
          <div className="text-xs uppercase tracking-wide text-cream-dim mb-1">Which domain?</div>
          <div className="flex flex-wrap gap-2">
            {domains.map((d, i) => (
              <NumberedButton key={d.id} number={i + 1} label={d.name} onClick={() => chooseDomain(d.id)} />
            ))}
          </div>
        </div>
      )}

      {stage === "note" && (
        <div className="border-t border-neutral-700 p-4 bg-neutral-800 space-y-2">
          <div className="text-xs uppercase tracking-wide text-cream-dim mb-1">
            {domains.find((d) => d.id === chosenDomainId)?.name ?? "..."} — continue or start new?
          </div>
          {noteMatches === null ? (
            <div className="text-sm text-cream-dim/70 py-1">Finding matches...</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {noteMatches.map((n, i) => (
                <NumberedButton
                  key={n.noteId}
                  number={i + 1}
                  label={`Continue: "${n.title}"`}
                  onClick={() => handleResolve({ type: "note", note_id: n.noteId })}
                />
              ))}
              <NumberedButton
                number={8}
                label={subfolders && subfolders.length > 0 ? "New Note..." : "New Note"}
                onClick={handleNewNoteClick}
              />
              <NumberedButton number={9} label="Resolve later" variant="ghost" onClick={handleDefer} />
              <NumberedButton
                number={0}
                label="Uncategorized"
                variant="muted"
                onClick={() => handleResolve({ type: "uncategorized" })}
              />
            </div>
          )}
        </div>
      )}

      {stage === "subfolder" && chosenDomainId && (
        <div className="border-t border-neutral-700 p-4 bg-neutral-800 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-wide text-cream-dim">
              New note in {domains.find((d) => d.id === chosenDomainId)?.name ?? "..."} — where?
            </div>
            <button
              onClick={() => setStage("note")}
              className="text-xs text-cream-dim/70 hover:text-cream transition"
            >
              ← Back
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            <NumberedButton
              number={1}
              label="(No subfolder)"
              onClick={() => handleResolve({ type: "domain", domain_id: chosenDomainId })}
            />
            {(subfolders ?? []).map((s, i) => (
              <NumberedButton
                key={s.id}
                number={i + 2}
                label={s.name}
                onClick={() => handleResolve({ type: "domain", domain_id: chosenDomainId, parent_folder_id: s.id })}
              />
            ))}
          </div>
        </div>
      )}

      {formatPhase !== "closed" && (
        <div className="border-t border-neutral-700 p-4 bg-neutral-800 space-y-3">
          {formatPhase === "input" && (
            <>
              <div className="text-xs uppercase tracking-wide text-cream-dim">
                Reformat with AI — instructions (optional)
              </div>
              <div className="text-xs text-cream-dim/50 -mt-2">
                Structure only — your wording stays as-is, nothing is reworded, summarized, or added.
              </div>
              <input
                autoFocus
                value={formatInstructions}
                onChange={(e) => setFormatInstructions(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && runFormat()}
                placeholder='e.g. "turn this into a table" — leave blank for general markdown cleanup'
                className="w-full px-2 py-1.5 rounded-md bg-neutral-900 border border-neutral-700 text-cream placeholder:text-cream-dim/50 text-sm focus:outline-none focus:ring-2 focus:ring-cream/40"
              />
              <div className="flex gap-2">
                <button
                  onClick={runFormat}
                  className="px-3 py-1.5 rounded-full text-sm font-medium bg-cream text-neutral-900 hover:bg-cream/90"
                >
                  Format
                </button>
                <button
                  onClick={cancelFormat}
                  className="px-3 py-1.5 rounded-full text-sm font-medium border border-neutral-600 text-cream-dim hover:bg-neutral-700"
                >
                  Cancel
                </button>
              </div>
            </>
          )}

          {formatPhase === "loading" && <div className="text-sm text-cream-dim/70 py-1">Formatting...</div>}

          {formatPhase === "preview" && (
            <>
              <div className="text-xs uppercase tracking-wide text-cream-dim">
                Preview above — apply, tweak the instructions, or discard
              </div>
              <div className="flex gap-2">
                <button
                  onClick={applyFormat}
                  className="px-3 py-1.5 rounded-full text-sm font-medium bg-cream text-neutral-900 hover:bg-cream/90"
                >
                  Apply
                </button>
                <button
                  onClick={() => setFormatPhase("input")}
                  className="px-3 py-1.5 rounded-full text-sm font-medium border border-neutral-600 text-cream-dim hover:bg-neutral-700"
                >
                  Try again
                </button>
                <button
                  onClick={cancelFormat}
                  className="px-3 py-1.5 rounded-full text-sm font-medium text-cream-dim/60 hover:bg-neutral-700"
                >
                  Discard
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {titleSuggestion && (
        <div className="border-t border-neutral-700 p-3 bg-neutral-800 flex items-center justify-between gap-3">
          <div className="text-sm text-cream-dim min-w-0 truncate">
            New title suggested: <span className="text-cream font-medium">"{titleSuggestion.newTitle}"</span>
            {titleSuggestion.oldTitle && <span className="text-cream-dim/70"> (was "{titleSuggestion.oldTitle}")</span>}
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={applyTitleSuggestion}
              className="px-3 py-1 rounded-full text-xs font-medium bg-cream text-neutral-900 hover:bg-cream/90"
            >
              Apply
            </button>
            <button
              onClick={() => setTitleSuggestion(null)}
              className="px-3 py-1 rounded-full text-xs font-medium border border-neutral-600 text-cream-dim hover:bg-neutral-700"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function NumberedButton({
  label,
  number,
  onClick,
  variant = "default",
}: {
  label: string;
  number: number;
  onClick: () => void;
  variant?: "default" | "muted" | "ghost";
}) {
  const styles = {
    default: "bg-cream text-neutral-900 hover:bg-cream/90",
    muted: "bg-neutral-700 text-cream-dim hover:bg-neutral-600",
    ghost: "bg-transparent text-cream-dim hover:bg-neutral-700 border border-neutral-600",
  }[variant];

  const badgeStyles = {
    default: "bg-neutral-900/15 text-neutral-900",
    muted: "bg-neutral-900/30 text-cream-dim",
    ghost: "bg-neutral-700 text-cream-dim",
  }[variant];

  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 pl-1.5 pr-3 py-1.5 rounded-full text-sm font-medium transition ${styles}`}
    >
      <span className={`flex items-center justify-center w-5 h-5 rounded-full text-xs font-semibold ${badgeStyles}`}>
        {number}
      </span>
      {label}
    </button>
  );
}
