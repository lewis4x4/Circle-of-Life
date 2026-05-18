import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export type NoteProps = {
  tone: "info";
  children?: ReactNode;
  className?: string;
};

/** Quiet inline note beneath a page masthead — not a bordered card hero. */
export function Note({ tone, children, className }: NoteProps) {
  if (tone !== "info") return null;
  return (
    <aside
      role="note"
      className={cn(
        "border-l-2 border-primary/35 py-1 pl-3 text-sm leading-relaxed text-muted-foreground",
        className,
      )}
    >
      {children}
    </aside>
  );
}
