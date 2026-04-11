"use client";

import React from "react";
import { MessageSquare, ThumbsUp, ThumbsDown, HelpCircle } from "lucide-react";
import type { ChatInsight } from "../lib/types";

interface ChatInsightsPanelProps {
  insights: ChatInsight | null;
  loading: boolean;
}

export function ChatInsightsPanel({ insights, loading }: ChatInsightsPanelProps) {
  if (loading || !insights) {
    return <div className="text-sm text-slate-400 py-8 text-center">Loading chat insights…</div>;
  }

  const cards = [
    { label: "Total Queries", value: insights.totalQueries, icon: MessageSquare, color: "text-blue-500" },
    { label: "Positive Feedback", value: insights.positiveFeedback, icon: ThumbsUp, color: "text-green-500" },
    { label: "Negative Feedback", value: insights.negativeFeedback, icon: ThumbsDown, color: "text-red-500" },
    { label: "Knowledge Gaps", value: insights.gapCount, icon: HelpCircle, color: "text-amber-500" },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <Icon className={`w-4 h-4 ${card.color} mb-2`} />
            <div className="text-2xl font-semibold text-slate-800 dark:text-zinc-100">{card.value}</div>
            <div className="text-xs text-slate-500 dark:text-zinc-400 mt-0.5">{card.label}</div>
          </div>
        );
      })}
    </div>
  );
}
