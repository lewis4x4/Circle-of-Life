"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type FilterPillTone = "default" | "warning" | "danger" | "success" | "info";

const toneClasses: Record<FilterPillTone, { active: string; semantic: string }> = {
  default: {
    active: "border-border-strong bg-muted text-foreground",
    semantic: "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground",
  },
  warning: {
    active: "border-warning bg-warning/10 text-warning",
    semantic: "border-warning/30 bg-card text-warning hover:bg-warning/5",
  },
  danger: {
    active: "border-destructive bg-destructive/10 text-destructive",
    semantic: "border-destructive/30 bg-card text-destructive hover:bg-destructive/5",
  },
  success: {
    active: "border-success bg-success/10 text-success",
    semantic: "border-success/30 bg-card text-success hover:bg-success/5",
  },
  info: {
    active: "border-info bg-info/10 text-info",
    semantic: "border-info/30 bg-card text-info hover:bg-info/5",
  },
};

export type FilterPillProps = Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
  label: string;
  count?: number;
  tone?: FilterPillTone;
  active?: boolean;
};

/** Muted at zero-count defaults; semantic color appears only for active or non-zero states. */
export function FilterPill({
  label,
  count,
  tone = "default",
  active = false,
  className,
  ...props
}: FilterPillProps) {
  const countValue = count ?? 0;
  const useSemantic = active || countValue > 0;
  const classes = active
    ? toneClasses[tone].active
    : useSemantic
      ? toneClasses[tone].semantic
      : "border-border bg-card text-muted-foreground hover:border-border-strong hover:text-foreground";

  return (
    <button
      type="button"
      aria-pressed={active}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2.5 py-1.5 text-[12px] font-medium normal-case tracking-normal transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        classes,
        className,
      )}
      {...props}
    >
      <span>{label}</span>
      {typeof count === "number" ? (
        <span className={cn("tabular-nums opacity-80", active && "opacity-100")}>({count})</span>
      ) : null}
    </button>
  );
}
