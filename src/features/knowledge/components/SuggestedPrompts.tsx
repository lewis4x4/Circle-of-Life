"use client";

import React from "react";
import { BookOpen, Shield, HelpCircle, ClipboardList } from "lucide-react";

interface SuggestedPromptsProps {
  onSelect: (prompt: string) => void;
}

const PROMPTS = [
  { icon: HelpCircle, label: "Residents", text: "What room is Elmer Price in?" },
  { icon: ClipboardList, label: "Operations", text: "Show me today's census and available beds." },
  { icon: BookOpen, label: "Policies", text: "What are our medication administration policies?" },
  { icon: Shield, label: "Compliance", text: "Show recent AHCA survey deficiencies and plans of correction." },
];

export function SuggestedPrompts({ onSelect }: SuggestedPromptsProps) {
  return (
    <div className="flex w-full max-w-3xl flex-col items-center gap-8 px-4 py-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Knowledge Base
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
            Ask about residents, daily operations, medications, incidents, compliance, and uploaded policies.
          </p>
        </div>
      </div>

      <div className="grid w-full grid-cols-1 gap-1 sm:grid-cols-2">
        {PROMPTS.map((p) => {
          const Icon = p.icon;
          return (
            <button
              key={p.label}
              type="button"
              onClick={() => onSelect(p.text)}
              className="group flex min-h-[33px] w-full flex-col items-start gap-1 rounded-[8px] border border-border bg-background px-[11px] py-2 text-left transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <div className="flex w-full items-center gap-2">
                <Icon className="size-4 text-muted-foreground" />
                <span className="text-[12px] font-medium text-foreground">{p.label}</span>
              </div>
              <p className="text-xs leading-tight text-muted-foreground">{p.text}</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
