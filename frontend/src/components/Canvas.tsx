import { useEffect, useRef, useState } from "react";
import {
  submitFragment,
  resolveFragment,
  deferFragment,
  cancelFragment,
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
  // Captured when the formatter is opened — if there was an active text
  // selection at that moment, only that range is sent to the AI and only
  // that range gets replaced on Apply. null means "operate on the whole draft".
  const [selectionRange, setSelectionRange] = useState<{ start: number; end: number } | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  // Backs out of the domain/note/subfolder routing flow entirely — e.g. an
  // accidental Ctrl+S. Unlike a normal resolve/defer, this deliberately
  // does NOT clear `text`: you didn't mean to submit, so the draft should
  // still be sitting there to keep editing. The backend fragment row (never
  // resolved) is deleted so cancelling doesn't leave orphaned rows behind.
  async function handleCancel() {
    const idToCancel = fragmentId;
    setFragmentId(null);
    setStage("idle");
    setChosenDomainId(null);
    setNoteMatches(null);
    setSubfolders(null);
    cancelFormat();
    focusCanvasAt();
    if (idToCancel) await cancelFragment(idToCancel).catch(() => {});
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
    setSelectionRange(null);
  }

  // Reads the textarea's current selection (if any) before opening the
  // panel — selection.start/end stay readable on the element even after
  // focus moves to the instructions input or the trigger button.
  function openFormatPanel() {
    if (!text.trim()) return;
    const ta = textareaRef.current;
    const hasSelection = !!ta && ta.selectionStart !== ta.selectionEnd;
    setSelectionRange(hasSelection ? { start: ta!.selectionStart, end: ta!.selectionEnd } : null);
    setFormatPhase("input");
  }

  async function runFormat() {
    if (!text.trim()) return;
    const source = selectionRange ? text.slice(selectionRange.start, selectionRange.end) : text;
    setFormatPhase("loading");
    const { formatted } = await formatText(source, formatInstructions);
    setFormatResult(formatted);
    setFormatPhase("preview");
  }

  // The full document with the formatted piece spliced in — used both for
  // the preview render (so you see it in context) and for Apply.
  function spliceFormatResult(): string {
    if (formatResult === null) return text;
    if (!selectionRange) return formatResult;
    return text.slice(0, selectionRange.start) + formatResult + text.slice(selectionRange.end);
  }

  // Focuses the canvas textarea after the format flow ends, placing the
  // cursor right after whatever was just inserted (or end-of-text for a
  // whole-draft format). Deferred to the next frame since it runs right
  // after a state update that may still be re-rendering the textarea.
  function focusCanvasAt(pos?: number) {
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus();
      if (pos !== undefined) ta.setSelectionRange(pos, pos);
    });
  }

  function applyFormat() {
    if (formatResult === null) return;
    const newText = spliceFormatResult();
    const cursorPos = selectionRange ? selectionRange.start + formatResult.length : newText.length;
    setText(newText);
    cancelFormat();
    focusCanvasAt(cursorPos);
  }

  function discardFormat() {
    cancelFormat();
    focusCanvasAt();
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
        openFormatPanel();
      }
    }
  }

  // Numeric shortcuts, meaning depends on which stage is showing.
  useEffect(() => {
    if (stage === "idle") return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        handleCancel();
        return;
      }
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
  }, [stage, domains, noteMatches, subfolders, chosenDomainId, fragmentId]);

  // 1/2/3 for Apply / Try again / Discard once the formatted preview is
  // showing. Separate effect (rather than folding into the one above)
  // since it's keyed off formatPhase, not stage — the two are independent.
  useEffect(() => {
    if (formatPhase !== "preview") return;
    function handleKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") {
        e.preventDefault();
        applyFormat();
      } else if (e.key === "2") {
        e.preventDefault();
        setFormatPhase("input");
      } else if (e.key === "3") {
        e.preventDefault();
        discardFormat();
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formatPhase, formatResult, selectionRange, text]);

  // Ctrl+Shift+V toggles Write/Preview. Window-level (not the textarea's own
  // onKeyDown, like Ctrl+S/Ctrl+Shift+F) since the textarea isn't even in
  // the DOM while Preview is showing — a handler scoped to it could only
  // ever fire in one direction.
  useEffect(() => {
    if (stage !== "idle" || !text.trim()) return;
    function handleKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault();
        setPreview((p) => !p);
      }
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [stage, text]);

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
              onClick={openFormatPanel}
              title="Ctrl+Shift+F — select some text first to format just that part"
              className="px-2.5 py-1 rounded-full border border-neutral-700 text-xs font-medium text-cream-dim hover:bg-neutral-800 hover:text-cream transition"
            >
              ✨ Format with AI <span className="text-cream-dim/50">Ctrl+Shift+F</span>
            </button>
          )}
          <div
            title="Ctrl+Shift+V toggles Write/Preview"
            className="flex rounded-full border border-neutral-700 overflow-hidden text-xs"
          >
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
      <div className="flex-1 px-8 pb-8 pt-16 min-h-0">
        {formatPhase === "preview" && formatResult !== null ? (
          <div className="w-full h-full overflow-y-auto text-cream text-base leading-relaxed">
            {/* Full document with the formatted piece spliced in, so a
                selection-scoped reformat previews in context rather than
                hiding the rest of the draft. */}
            <Markdown>{spliceFormatResult()}</Markdown>
          </div>
        ) : preview && stage === "idle" ? (
          <div className="w-full h-full overflow-y-auto text-cream text-base leading-relaxed">
            <Markdown>{text}</Markdown>
          </div>
        ) : (
          <div className="relative w-full h-full">
            {/* A textarea's own text selection dims to grey the moment it
                loses focus (typing into the instructions box, clicking
                Format) — browsers don't let CSS override that. This mirrors
                the selected range as a background highlight sitting behind
                the (transparent-background) textarea, so it stays mud-green
                for as long as the format flow is open, regardless of focus. */}
            {selectionRange && (formatPhase === "input" || formatPhase === "loading") && (
              <div
                aria-hidden
                className="absolute inset-0 whitespace-pre-wrap break-words text-base leading-relaxed pointer-events-none"
                style={{ color: "transparent" }}
              >
                {text.slice(0, selectionRange.start)}
                <span style={{ backgroundColor: "#5c6b47" }}>
                  {text.slice(selectionRange.start, selectionRange.end)}
                </span>
                {text.slice(selectionRange.end)}
              </div>
            )}
            <textarea
              ref={textareaRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={stage !== "idle" || formatPhase === "loading"}
              placeholder="Write whatever you want. ⌘S / Ctrl+S to save."
              className="relative w-full h-full resize-none focus:outline-none bg-transparent text-cream placeholder:text-cream-dim/50 text-base leading-relaxed disabled:opacity-60"
            />
          </div>
        )}
      </div>

      {stage === "domain" && (
        <div className="border-t border-neutral-700 p-4 bg-neutral-800 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-wide text-cream-dim">Which domain?</div>
            <button onClick={handleCancel} className="text-xs text-cream-dim/70 hover:text-cream transition">
              ✕ Cancel <span className="text-cream-dim/40">Esc</span>
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {domains.map((d, i) => (
              <NumberedButton key={d.id} number={i + 1} label={d.name} onClick={() => chooseDomain(d.id)} />
            ))}
          </div>
        </div>
      )}

      {stage === "note" && (
        <div className="border-t border-neutral-700 p-4 bg-neutral-800 space-y-2">
          <div className="flex items-center justify-between mb-1">
            <div className="text-xs uppercase tracking-wide text-cream-dim">
              {domains.find((d) => d.id === chosenDomainId)?.name ?? "..."} — continue or start new?
            </div>
            <button onClick={handleCancel} className="text-xs text-cream-dim/70 hover:text-cream transition">
              ✕ Cancel <span className="text-cream-dim/40">Esc</span>
            </button>
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
            <div className="flex items-center gap-3">
              <button
                onClick={() => setStage("note")}
                className="text-xs text-cream-dim/70 hover:text-cream transition"
              >
                ← Back
              </button>
              <button onClick={handleCancel} className="text-xs text-cream-dim/70 hover:text-cream transition">
                ✕ Cancel <span className="text-cream-dim/40">Esc</span>
              </button>
            </div>
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
                {selectionRange
                  ? `Reformat selected text (${selectionRange.end - selectionRange.start} characters) — instructions (optional)`
                  : "Reformat with AI — instructions (optional)"}
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
                <NumberedButton number={1} label="Apply" onClick={applyFormat} />
                <NumberedButton number={2} label="Try again" variant="ghost" onClick={() => setFormatPhase("input")} />
                <NumberedButton number={3} label="Discard" variant="muted" onClick={discardFormat} />
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
