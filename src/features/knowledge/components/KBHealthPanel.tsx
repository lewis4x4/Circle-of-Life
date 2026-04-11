"use client";

import React from "react";
import { FileText, Database, Zap, AlertTriangle } from "lucide-react";
import type { KBHealthMetrics } from "../lib/types";

interface KBHealthPanelProps {
  health: KBHealthMetrics | null;
  loading: boolean;
}

export function KBHealthPanel({ health, loading }: KBHealthPanelProps) {
  if (loading || !health) {
    return <div className="text-sm text-slate-400 py-8 text-center">Loading health metrics…</div>;
  }

  const cards = [
    {
      label: "Documents",
      value: health.totalDocuments,
      sub: `${health.publishedDocuments} published`,
      icon: FileText,
      color: "text-blue-500",
    },
    {
      label: "Chunks",
      value: health.totalChunks,
      sub: `${health.avgChunksPerDoc.toFixed(0)} avg/doc`,
      icon: Database,
      color: "text-green-500",
    },
    {
      label: "Embedding Coverage",
      value: `${health.embeddingCoverage.toFixed(1)}%`,
      sub: "vectors indexed",
      icon: Zap,
      color: "text-indigo-500",
    },
    {
      label: "Failed Ingestions",
      value: health.failedIngestions,
      sub: "need attention",
      icon: AlertTriangle,
      color: health.failedIngestions > 0 ? "text-red-500" : "text-slate-400",
    },
  ];

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map((card) => {
        const Icon = card.icon;
        return (
          <div key={card.label} className="rounded-xl border border-slate-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 p-4">
            <div className="flex items-center gap-2 mb-2">
              <Icon className={`w-4 h-4 ${card.color}`} />
              <span className="text-xs font-medium text-slate-500 dark:text-zinc-400">{card.label}</span>
            </div>
            <div className="text-2xl font-semibold text-slate-800 dark:text-zinc-100">{card.value}</div>
            <div className="text-xs text-slate-400 dark:text-zinc-500 mt-0.5">{card.sub}</div>
          </div>
        );
      })}
    </div>
  );
}
