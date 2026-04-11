"use client";

import React from "react";
import { BookOpen, Shield, HelpCircle, ClipboardList } from "lucide-react";

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
}

const PROMPTS = [
  { icon: BookOpen, label: "Policies", text: "What are our medication administration policies?" },
  { icon: Shield, label: "Compliance", text: "What AHCA regulations apply to infection control?" },
  { icon: HelpCircle, label: "Procedures", text: "What is the procedure for a new resident admission?" },
  { icon: ClipboardList, label: "Training", text: "What training is required for new staff members?" },
];

export function SuggestedPrompts({ onSelect }: SuggestedPromptsProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-6 px-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold text-slate-800 dark:text-zinc-100">Knowledge Base</h2>
        <p className="text-sm text-slate-500 dark:text-zinc-400 mt-1">
          Ask anything about policies, procedures, and compliance
        </p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-lg w-full">
        {PROMPTS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onSelect(p.text)}
              className="flex items-center gap-3 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white dark:bg-zinc-800/50 px-4 py-3 text-left hover:border-indigo-300 dark:hover:border-indigo-500 hover:bg-indigo-50/50 dark:hover:bg-indigo-950/20 transition-all"
            >
              <Icon className="w-5 h-5 text-indigo-500 shrink-0" />
              <div>
                <div className="text-xs font-medium text-slate-700 dark:text-zinc-300">{p.label}</div>
                <div className="text-xs text-slate-500 dark:text-zinc-400 line-clamp-1">{p.text}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
