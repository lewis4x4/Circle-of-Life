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

const HavenInsightCtx = createContext<HavenInsightState | null>(null);

export function useHavenInsight(): HavenInsightState {
  const ctx = useContext(HavenInsightCtx);
  if (!ctx) throw new Error("useHavenInsight must be used within HavenInsightProvider");
  return ctx;
}

export function HavenInsightProvider({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { kpis } = useExecRoleKpis();

  const [isOpen, setIsOpen] = useState(false);
  const [messages, setMessages] = useState<HavenInsightMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentModule = useMemo(() => resolveModuleContext(pathname), [pathname]);
  const suggestedQuestions = useMemo(
    () => generateDynamicSuggestions(currentModule, kpis),
    [currentModule, kpis],
  );

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen(p => !p), []);
  const clearChat = useCallback(() => { setMessages([]); setError(null); }, []);

  const sendQuestion = useCallback(async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;

    setError(null);
    const userMsg: HavenInsightMessage = { id: `u-${Date.now()}`, role: "user", content: q, timestamp: new Date() };
    setMessages(prev => [...prev.slice(-MAX_MESSAGES + 1), userMsg]);
    setLoading(true);

    try {
      const res = await authorizedEdgeFetch("exec-nlq-executor", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          route: pathname,
          module: currentModule.module,
        }),
      }, "haven-insight");

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
