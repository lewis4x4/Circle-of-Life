"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type CopilotButtonStubProps = {
  label?: string;
  className?: string;
};

export function CopilotButtonStub({ label = "Copilot", className }: CopilotButtonStubProps) {
  const [open, setOpen] = useState(false);

  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={open}
      aria-haspopup="dialog"
      onClick={() => setOpen((prev) => !prev)}
      data-stub="ui-v2-s5"
      className={cn(
        "inline-flex h-8 items-center gap-2 rounded-sm border border-brand-accent bg-surface-elevated px-3 text-xs font-semibold text-text-primary hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-accent",
        className,
      )}
    >
      <span aria-hidden="true" className="inline-block h-2 w-2 rounded-full bg-brand-accent" />
      {label}
      <span className="text-xs font-medium uppercase tracking-caps text-text-muted">
        cite-backed
      </span>
    </button>
  );
}
