import { useEffect, useState } from "react";
import { getNote } from "../lib/api.js";
import { Markdown } from "./Markdown.js";

interface NoteData {
  id: string;
  title: string;
  body: string;
}

export function NoteDetail({ noteId, onClose }: { noteId: string; onClose: () => void }) {
  const [note, setNote] = useState<NoteData | null>(null);
  const [actionResult, setActionResult] = useState<{ label: string; text: string } | null>(null);

  useEffect(() => {
    getNote(noteId).then(setNote);
    setActionResult(null);
  }, [noteId]);

  async function runAction(action: "summarize" | "polish") {
    const res = await fetch(
      `${import.meta.env.VITE_API_URL ?? "http://localhost:4000"}/notes/${noteId}/actions/${action}`,
      { method: "POST" }
    );
    const data = await res.json();
    setActionResult({
      label: action === "summarize" ? "Summary" : "Polished version",
      text: data.summary ?? data.polished,
    });
  }

  if (!note) return <div className="p-4 text-cream-dim text-sm">Loading...</div>;

  return (
    <div className="h-full flex flex-col bg-neutral-800 border-l border-neutral-700">
      <div className="flex items-center justify-between p-3 border-b border-neutral-700">
        <h2 className="font-medium text-cream truncate">{note.title}</h2>
        <button onClick={onClose} className="text-cream-dim hover:text-cream px-2">
          ✕
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 text-cream-dim text-sm leading-relaxed">
        <Markdown>{note.body}</Markdown>
      </div>

      {actionResult && (
        <div className="border-t border-neutral-700 p-3 bg-neutral-900 max-h-48 overflow-y-auto">
          <div className="text-xs uppercase tracking-wide text-cream-dim/70 mb-1">{actionResult.label}</div>
          <div className="text-sm text-cream-dim">
            <Markdown>{actionResult.text}</Markdown>
          </div>
        </div>
      )}

      <div className="border-t border-neutral-700 p-3 flex gap-2 flex-wrap">
        <ActionButton label="Edit" onClick={() => {}} />
        <ActionButton label="Summarize" onClick={() => runAction("summarize")} />
        <ActionButton label="Polish" onClick={() => runAction("polish")} />
        <ActionButton label="Ask about this" variant="ghost" onClick={() => {}} />
      </div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  variant = "default",
}: {
  label: string;
  onClick: () => void;
  variant?: "default" | "ghost";
}) {
  const styles =
    variant === "ghost"
      ? "bg-transparent text-cream-dim border border-neutral-600 hover:bg-neutral-700"
      : "bg-cream text-neutral-900 hover:bg-cream/90";
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-full text-sm font-medium transition ${styles}`}>
      {label}
    </button>
  );
}
