// Inline AI formatter — instructions + raw text -> reformatted markdown.
// Not tied to notes/fragments at all; the Canvas calls this on whatever's
// currently in the textarea before capture.
import { getLLM } from "./ai/index.js";

// Always included, regardless of what the user's own instructions say —
// this is formatting only. Custom instructions (e.g. "turn this into a
// table") control *structure*, never license rewording/summarizing/adding
// content; those are Polish's/Summarize's job, not this one's.
const HARD_CONSTRAINT =
  "You are a formatter, not a writer. Restructure the given text into markdown — do not paraphrase, reword, summarize, shorten, expand, or add any information that isn't already there. Preserve the original wording verbatim wherever possible; you may only add markdown syntax (headers, list markers, table pipes, bold/italic, code fences) around the existing words. If a requested structure would require changing the wording or meaning to fit, leave that part as plain text instead of forcing it.";

const DEFAULT_INSTRUCTIONS =
  "Reformat this into clean, well-structured markdown — use headers, bullet or numbered lists, and tables where they genuinely fit.";

export async function formatText(text: string, instructions?: string): Promise<string> {
  const directive = instructions?.trim() || DEFAULT_INSTRUCTIONS;
  const result = await getLLM().complete({
    maxTokens: 2000,
    messages: [
      {
        role: "user",
        content: `${HARD_CONSTRAINT}\n\n${directive}\n\nText to reformat:\n\n${text}\n\nReturn only the reformatted markdown — no commentary, no preamble, and don't wrap the whole answer in a code fence.`,
      },
    ],
  });
  return result.trim();
}
