"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { streamSSE } from "@/features/knowledge/lib/stream-parser";
import { graceKnowledgeStream } from "./api";
import { pushGracePresence } from "./presence";
import type {
  GraceKnowledgeMeta,
  GraceKnowledgeSource,
  GraceKnowledgeStatus,
} from "./types";

export interface GraceKnowledgeStreamApi {
  status: GraceKnowledgeStatus;
  text: string;
  meta: GraceKnowledgeMeta | null;
  sources: GraceKnowledgeSource[];
  kbEmpty: boolean;
  error: string | null;
  start: (input: { message: string; conversationId?: string; organizationId: string; route?: string }) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useGraceKnowledgeStream(): GraceKnowledgeStreamApi {
  const [status, setStatus] = useState<GraceKnowledgeStatus>("idle");
  const [text, setText] = useState("");
  const [meta, setMeta] = useState<GraceKnowledgeMeta | null>(null);
  const [sources, setSources] = useState<GraceKnowledgeSource[]>([]);
  const [kbEmpty, setKbEmpty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const presenceReleaseRef = useRef<(() => void) | null>(null);

  const releasePresence = useCallback(() => {
    if (presenceReleaseRef.current) {
      presenceReleaseRef.current();
      presenceReleaseRef.current = null;
    }
  }, []);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    releasePresence();
    setStatus("idle");
  }, [releasePresence]);

  const reset = useCallback(() => {
    cancel();
    setText("");
    setMeta(null);
    setSources([]);
    setKbEmpty(false);
    setError(null);
  }, [cancel]);

  const start = useCallback(
    async (input: { message: string; conversationId?: string; organizationId: string; route?: string }) => {
      cancel();
      setText("");
      setMeta(null);
      setSources([]);
      setKbEmpty(false);
      setError(null);
      setStatus("connecting");
      presenceReleaseRef.current = pushGracePresence("grace-knowledge", "thinking");

      const controller = new AbortController();
      abortRef.current = controller;

      let res: Response;
      try {
        res = await graceKnowledgeStream({
          message: input.message,
          conversation_id: input.conversationId,
          organization_id: input.organizationId,
          route: input.route,
        });
      } catch (streamError) {
        setError(streamError instanceof Error ? streamError.message : "Grace request failed");
        setStatus("error");
        releasePresence();
        return;
      }

      if (!res.ok || !res.body) {
        const body = await res.text().catch(() => "");
        setError(`knowledge-agent ${res.status}: ${body.slice(0, 200)}`);
        setStatus("error");
        releasePresence();
        return;
      }

      setStatus("streaming");
      let firstTokenSeen = false;
      try {
        for await (const event of streamSSE(res)) {
          switch (event.type) {
            case "meta":
              setMeta(event.meta as GraceKnowledgeMeta);
              break;
            case "text":
              if (!firstTokenSeen) {
                firstTokenSeen = true;
                releasePresence();
                presenceReleaseRef.current = pushGracePresence("grace-knowledge", "speaking");
              }
              setText((prev) => prev + event.text);
              break;
            case "sources":
              setSources(event.sources as GraceKnowledgeSource[]);
              break;
            case "kb_empty":
              setKbEmpty(true);
              break;
            case "error":
              setError(event.error ?? "Grace stream failed");
              setStatus("error");
              releasePresence();
              return;
            case "done":
              setStatus("done");
              releasePresence();
              abortRef.current = null;
              return;
          }
        }
      } catch (streamError) {
        if ((streamError as { name?: string }).name !== "AbortError") {
          setError(streamError instanceof Error ? streamError.message : "Grace stream failed");
          setStatus("error");
          releasePresence();
          return;
        }
      }

      setStatus("done");
      releasePresence();
      abortRef.current = null;
    },
    [cancel, releasePresence],
  );

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
      releasePresence();
    };
  }, [releasePresence]);

  return { status, text, meta, sources, kbEmpty, error, start, cancel, reset };
}
