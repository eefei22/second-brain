// Anthropic implementation of LLMProvider — this is what the routes used to
// call directly. Refactored behind the shared interface so it's a drop-in
// alternate: set LLM_PROVIDER=anthropic (+ ANTHROPIC_API_KEY) to switch back.
import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, CompleteParams } from "./types.js";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.ANTHROPIC_CHAT_MODEL ?? "claude-sonnet-4-6";

export const anthropicLLM: LLMProvider = {
  async complete(params: CompleteParams) {
    const result = await client.messages.create({
      model: MODEL,
      max_tokens: params.maxTokens,
      system: params.system,
      messages: params.messages,
    });
    const text = result.content.find((b) => b.type === "text");
    return text?.type === "text" ? text.text : "";
  },

  stream(params: CompleteParams, onDelta: (delta: string) => void) {
    return new Promise<string>((resolve, reject) => {
      const stream = client.messages.stream({
        model: MODEL,
        max_tokens: params.maxTokens,
        system: params.system,
        messages: params.messages,
      });
      let full = "";
      stream.on("text", (delta) => {
        full += delta;
        onDelta(delta);
      });
      stream.on("end", () => resolve(full));
      stream.on("error", reject);
    });
  },
};
