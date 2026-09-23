import Groq from "groq-sdk";
import { config } from "./config.js";

const groq = new Groq({ apiKey: config.groqApiKey, maxRetries: 3 });

export async function chatCompletion(messages) {
  const completion = await groq.chat.completions.create({
    model: config.groqModel,
    messages,
    temperature: 0.2,
    max_tokens: 400,
  });
  return stripReasoning(completion.choices[0]?.message?.content ?? "");
}

// Some Groq models (e.g. qwen) emit <think>...</think> before the answer.
export function stripReasoning(text) {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").trim();
}
