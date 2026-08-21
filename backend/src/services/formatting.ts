// Inline AI formatter — instructions + raw text -> reformatted markdown.
// Not tied to notes/fragments at all; the Canvas calls this on whatever's
// currently in the textarea before capture.
import { getLLM } from "./ai/index.js";

const DEFAULT_INSTRUCTIONS =
  "Reformat this into clean, well-structured markdown — use headers, bullet or numbered lists, and tables where they genuinely fit. Don't change the meaning, don't add new information, don't invent facts.";

export async function formatText(text: string, instructions?: string): Promise<string> {
  const directive = instructions?.trim() || DEFAULT_INSTRUCTIONS;
  const result = await getLLM().complete({
    maxTokens: 2000,
    messages: [
      {
        role: "user",
        content: `${directive}\n\nText to reformat:\n\n${text}\n\nReturn only the reformatted markdown — no commentary, no preamble, and don't wrap the whole answer in a code fence.`,
      },
    ],
  });
  return result.trim();
}
