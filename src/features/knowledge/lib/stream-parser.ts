import type { KBSource, StreamMeta } from "./types";

export interface StreamEvent {
  type: "meta" | "text" | "sources" | "error" | "done";
  meta?: StreamMeta;
  text?: string;
  sources?: KBSource[];
  error?: string;
}

export function parseSSELine(line: string): StreamEvent | null {
  if (!line.startsWith("data: ")) return null;
  const payload = line.slice(6).trim();
  if (payload === "[DONE]") return { type: "done" };

  try {
    const event = JSON.parse(payload) as Record<string, unknown>;
    if (event.meta) return { type: "meta", meta: event.meta as StreamMeta };
    if (event.text) return { type: "text", text: event.text as string };
    if (event.sources) return { type: "sources", sources: event.sources as KBSource[] };
    if (event.error) return { type: "error", error: event.error as string };
  } catch {
    // Ignore malformed lines
  }
  return null;
}

export async function* streamSSE(response: Response): AsyncGenerator<StreamEvent> {
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const event = parseSSELine(line);
      if (event) yield event;
      if (event?.type === "done") return;
    }
  }
}
