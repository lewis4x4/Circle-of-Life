"use client";

import { useState, useCallback, useRef, useEffect } from "react";
import type { KBSource, StreamMeta, StreamState } from "../lib/types";
import { sendChatMessage } from "../lib/knowledge-api";
import { streamSSE } from "../lib/stream-parser";

async function readErrorHint(res: Response): Promise<string> {
  try {
    const text = await res.text();
    if (!text) return `Request failed: ${res.status}`;
    try {
      const j = JSON.parse(text) as { error?: string };
      if (typeof j.error === "string" && j.error.length > 0) return j.error;
    } catch {
      return text.slice(0, 300);
    }
  } catch {
    /* ignore */
  }
  return `Request failed: ${res.status}`;
}

export function useKnowledgeStream(workspaceId: string | null) {
  const [state, setState] = useState<StreamState>("idle");
  const [text, setText] = useState("");
  const [sources, setSources] = useState<KBSource[]>([]);
  const [meta, setMeta] = useState<StreamMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Shown immediately while streaming; cleared in reset() or overwritten on next send */
  const [pendingUserMessage, setPendingUserMessage] = useState<string | null>(null);
  const [kbEmpty, setKbEmpty] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  const send = useCallback(
    async (message: string, conversationId?: string) => {
      if (!workspaceId) {
        setError("Missing organization context.");
        setState("error");
        return;
      }

      abortRef.current?.abort();
      abortRef.current = new AbortController();

      setState("connecting");
      setText("");
      setSources([]);
      setMeta(null);
      setError(null);
      setKbEmpty(false);
      setPendingUserMessage(message.trim());

      try {
        const res = await sendChatMessage(message, {
          conversationId,
          workspaceId,
          signal: abortRef.current.signal,
        });
        if (!res.ok) {
          const hint = await readErrorHint(res);
          setError(hint);
          setState("error");
          return;
        }

        setState("streaming");

        for await (const event of streamSSE(res)) {
          switch (event.type) {
            case "meta":
              setMeta(event.meta!);
              break;
            case "text":
              setText((prev) => prev + event.text!);
              break;
            case "sources":
              setSources(event.sources!);
              break;
            case "kb_empty":
              setKbEmpty(true);
              break;
            case "error":
              setError(event.error!);
              setState("error");
              return;
            case "done":
              setState("done");
              return;
          }
        }

        setState("done");
      } catch (err: unknown) {
        const e = err as { name?: string; message?: string };
        if (e.name !== "AbortError") {
          setError(e.message ?? "Request failed");
          setState("error");
        }
      }
    },
    [workspaceId],
  );

  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState("idle");
    setText("");
    setSources([]);
    setMeta(null);
    setError(null);
    setPendingUserMessage(null);
    setKbEmpty(false);
  }, []);

  return { state, text, sources, meta, error, pendingUserMessage, kbEmpty, send, reset };
}
