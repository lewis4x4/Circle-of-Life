"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";

import { CopilotDrawer } from "./CopilotDrawer";
import type { CopilotAction, CopilotSuggestion } from "./types";

export type CopilotButtonProps = {
  suggestions: unknown[];
  onAction?: (action: CopilotAction, suggestion: CopilotSuggestion) => void;
  label?: string;
  className?: string;
};

export function CopilotButton({
  suggestions,
  onAction,
  label = "Copilot",
  className,
}: CopilotButtonProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className={cn(
          "inline-flex h-8 items-center gap-2 rounded-sm border border-brand-accent bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
          className,
        )}
      >
        <SparkleIcon />
        {label}
        <span className="text-xs font-medium uppercase tracking-caps text-text-muted">
          cite-backed
        </span>
      </button>
      <CopilotDrawer
        open={open}
        onClose={() => setOpen(false)}
        suggestions={suggestions}
        onAction={onAction}
      />
    </>
  );
}

function SparkleIcon() {
  return (
    <span aria-hidden="true" className="text-sm leading-none">
      ✦
    </span>
  );
}
