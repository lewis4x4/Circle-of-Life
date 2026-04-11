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
    <div className="flex w-full max-w-3xl flex-col items-center gap-10 px-4 py-8">
      <div className="flex flex-col items-center gap-4 text-center">
        <div
          className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-[0_0_32px_rgba(99,102,241,0.35)]"
          aria-hidden
        >
          <span className="font-display text-2xl font-bold leading-none text-white">H</span>
        </div>
        <div>
          <h1 className="font-display text-3xl font-semibold tracking-tight text-zinc-100 sm:text-4xl">
            Knowledge Base
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-base leading-relaxed text-zinc-400">
            Ask anything about Florida ALF policies, procedures, compliance, and day-to-day operations.
          </p>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4">
        {PROMPTS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onSelect(p.text)}
              className="group flex w-full flex-col items-start gap-2 rounded-2xl border border-zinc-700/80 bg-zinc-900/60 px-5 py-4 text-left shadow-sm backdrop-blur-sm transition hover:border-indigo-500/50 hover:bg-indigo-950/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500/80"
            >
              <div className="flex w-full items-center gap-3">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-400 ring-1 ring-indigo-500/20">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold text-zinc-200">{p.label}</span>
              </div>
              <p className="pl-12 text-sm leading-snug text-zinc-400 group-hover:text-zinc-300">{p.text}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
