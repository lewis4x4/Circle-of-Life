"use client";

import React, { createContext, useContext, useState, useCallback, useMemo } from "react";
import { usePathname } from "next/navigation";
import { resolveModuleContext, generateDynamicSuggestions, type ModuleContext } from "./context-map";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";
import { authorizedEdgeFetch } from "@/lib/supabase/edge-auth";

export interface HavenInsightMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  tokensUsed?: number;
}

interface HavenInsightState {
  isOpen: boolean;
  messages: HavenInsightMessage[];
  currentModule: ModuleContext;
  suggestedQuestions: string[];
  loading: boolean;
  error: string | null;
  open: () => void;
  close: () => void;
  toggle: () => void;
  sendQuestion: (text: string) => Promise<void>;
  clearChat: () => void;
}

const MAX_MESSAGES = 50;

// KB-NEXT-01: router cutover is reversible by setting NEXT_PUBLIC_AI_ROUTER_ENABLED=false.
// Router returns a superset of the legacy exec-nlq-executor shape (adds `intent`,
// `intent_confidence`, `tools_used`, `citations`, `fallback_used`, etc.). The UI
// reads the same fields and ignores the extras.
const ROUTER_ENABLED = process.env.NEXT_PUBLIC_AI_ROUTER_ENABLED !== "false";

const HavenInsightCtx = createContext<HavenInsightState | null>(null);

export function useHavenInsight(): HavenInsightState {
  const ctx = useContext(HavenInsightCtx);
  if (!ctx) throw new Error("useHavenInsight must be used within HavenInsightProvider");
  return ctx;
}

export function HavenInsightProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // `hasOpened` flips true the first time the panel is opened and stays true
  // for the life of the provider. Gating useExecRoleKpis on it keeps 4 admin
  // Supabase queries + a realtime subscription from firing on every admin page
  // load for a panel most users never open.
  const [hasOpened, setHasOpened] = useState(false);
  const { kpis } = useExecRoleKpis(undefined, hasOpened);

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<HavenInsightMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentModule = useMemo(() => resolveModuleContext(pathname), [pathname]);
  const suggestedQuestions = useMemo(
    () => generateDynamicSuggestions(currentModule, kpis),
    [currentModule, kpis],
  );

  const open = useCallback(() => {
    setHasOpened(true);
    setIsOpen(true);
  }, []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => {
    setIsOpen((prev) => {
      if (!prev) setHasOpened(true);
      return !prev;
    });
  }, []);
  const clearChat = useCallback(() => { setMessages([]); setError(null); }, []);

  const sendQuestion = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;

    setError(null);
    const userMsg: HavenInsightMessage = { id: `u-${Date.now()}`, role: "user", content: q, timestamp: new Date() };
    setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), userMsg]);
    setLoading(true);

    try {
      const payload = JSON.stringify({
        question: q,
        route: pathname,
        module: currentModule.module,
      });

      let res: Response | null = null;
      let routerFailed = false;

      if (ROUTER_ENABLED) {
        try {
          res = await authorizedEdgeFetch(
            "haven-ai-router",
            { method: "POST", body: payload },
            "haven-insight",
          );
          // Treat 5xx OR an explicit X-Router-Failure header as a router-tier failure
          // and fall back to exec-nlq-executor so the user still gets an answer.
          if (res.status >= 500 || res.headers.get("X-Router-Failure") === "true") {
            routerFailed = true;
          }
        } catch {
          routerFailed = true;
        }
      }

      if (!ROUTER_ENABLED || routerFailed) {
        res = await authorizedEdgeFetch(
          "exec-nlq-executor",
          { method: "POST", body: payload },
          "haven-insight",
        );
      }

      if (!res) throw new Error("No response from Haven AI");
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed to get response");

      const aiMsg: HavenInsightMessage = {
        id: data.session_id || `a-${Date.now()}`,
        role: "assistant",
        content: data.answer || "No response generated.",
        timestamp: new Date(),
        tokensUsed: data.tokens_used,
      };
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), aiMsg]);
    } catch (err) {
      const errMsg: HavenInsightMessage = {
        id: `e-${Date.now()}`,
        role: "assistant",
        content: `I couldn't process that right now. ${err instanceof Error ? err.message : "Please try again."}`,
        timestamp: new Date(),
      };
      setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), errMsg]);
      setError(err instanceof Error ? err.message : "Query failed");
    } finally {
      setLoading(false);
    }
  }, [loading, pathname, currentModule.module]);

  const value = useMemo<HavenInsightState>(() => ({
    isOpen, messages, currentModule, suggestedQuestions, loading, error,
    open, close, toggle, sendQuestion, clearChat,
  }), [isOpen, messages, currentModule, suggestedQuestions, loading, error, open, close, toggle, sendQuestion, clearChat]);

  return <HavenInsightCtx.Provider value={value}>{children}</HavenInsightCtx.Provider>;
}
