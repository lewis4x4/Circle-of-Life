"use client";

import React from "react";
import { HelpCircle, Check, Clock } from "lucide-react";
import type { KnowledgeGapRow } from "../lib/types";

interface KnowledgeGapsPanelProps {
  gaps: KnowledgeGapRow[];
  loading: boolean;
  onResolve: (gapId: string) => void;
}

export function KnowledgeGapsPanel({ gaps, loading, onResolve }: KnowledgeGapsPanelProps) {
  if (loading) {
    return <div className="text-sm text-slate-400 py-8 text-center">Loading knowledge gaps…</div>;
  }

  const unresolved = gaps.filter((g) => !g.resolved);
  const resolved = gaps.filter((g) => g.resolved);

  return (
    <div className="space-y-4">
      <div className="text-sm font-medium text-slate-700 dark:text-zinc-300">
        {unresolved.length} unresolved gap{unresolved.length !== 1 ? "s" : ""}
      </div>

      <div className="space-y-2">
        {unresolved.map((gap) => (
          <div
            key={gap.id}
            className="flex items-start gap-3 rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-3"
          >
            <HelpCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-sm text-slate-800 dark:text-zinc-200">{gap.question}</div>
              <div className="flex items-center gap-3 mt-1 text-xs text-slate-400 dark:text-zinc-500">
                <span>Asked {gap.frequency}x</span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {new Date(gap.last_asked_at).toLocaleDateString()}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => onResolve(gap.id)}
              className="shrink-0 text-xs rounded-lg bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400 px-2.5 py-1.5 hover:bg-green-100 dark:hover:bg-green-900/40 transition-colors"
            >
              <Check className="w-3 h-3 inline mr-1" />
              Resolve
            </button>
          </div>
        ))}
      </div>

      {resolved.length > 0 && (
        <details className="text-sm">
          <summary className="text-slate-500 dark:text-zinc-400 cursor-pointer py-2">
            {resolved.length} resolved gap{resolved.length !== 1 ? "s" : ""}
          </summary>
          <div className="space-y-2 mt-2">
            {resolved.map((gap) => (
              <div
                key={gap.id}
                className="flex items-center gap-2 rounded-lg bg-slate-50 dark:bg-zinc-800/50 px-3 py-2 text-sm text-slate-500 dark:text-zinc-400 line-through"
              >
                {gap.question}
              </div>
            ))}
          </div>
        </details>
      )}

      {gaps.length === 0 && (
        <div className="text-center py-8 text-slate-400 dark:text-zinc-500 text-sm">
          No knowledge gaps detected yet. Gaps are logged when the AI cannot find relevant documents.
        </div>
      )}
    </div>
  );
}
