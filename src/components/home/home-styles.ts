import type { HomeBucket } from "@/lib/home/on-tap-model";

/** Rank badge and tag tones from the mockup: purple regulatory, warning rent, primary assigned, muted FYI, success cleared. */
export const RANK_BADGE_CLASS: Record<HomeBucket | "cleared", string> = {
  regulatory: "border-emar-held/40 bg-emar-held/10 text-emar-held",
  rent: "border-warning/40 bg-warning/10 text-warning",
  assigned: "border-primary/40 bg-primary/10 text-primary",
  fyi: "border-border bg-muted text-muted-foreground",
  cleared: "border-success/40 bg-success/10 text-success",
};

export const TAG_CLASS: Record<"regulatory" | "rent" | "assigned" | "fyi" | "overdue", string> = {
  regulatory: "border-emar-held/40 text-emar-held",
  rent: "border-warning/40 text-warning",
  assigned: "border-primary/40 text-primary",
  fyi: "border-border text-muted-foreground",
  overdue: "border-destructive/40 text-destructive",
};

export const CARD_CLASS = "rounded-lg border border-border bg-card shadow-[var(--shadow-card)]";
export const CARD_HEAD_CLASS = "flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3";
export const LINK_BUTTON_CLASS =
  "inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-xs font-medium text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
