"use client";

import { Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";

import { FLOOR_OUTLINE_BUTTON } from "./floor-styles";

/**
 * The non-populated data states in the floor style (DESIGN.md §2 item 5):
 * loading, error (with what to do next) and empty (what no rows means).
 */
export function FloorStatePanel({
  state,
  title,
  detail,
  onRetry,
  retryLabel = "Try again",
  pageTitle,
  className,
}: {
  state: "loading" | "error" | "empty";
  title: string;
  detail?: string | null;
  onRetry?: () => void;
  retryLabel?: string;
  /** When the panel is the whole screen: the screen's name, as its (visually hidden) h1. */
  pageTitle?: string;
  className?: string;
}) {
  return (
    <div
      role={state === "error" ? "alert" : "status"}
      aria-live="polite"
      className={cn("flex flex-col items-center justify-center gap-2 px-6 py-10 text-center", className)}
    >
      {pageTitle ? <h1 className="sr-only">{pageTitle}</h1> : null}
      {state === "loading" ? (
        <Loader2 className="mb-1 size-6 animate-spin text-muted-foreground motion-reduce:animate-none" aria-hidden />
      ) : null}
      <p className={cn("text-[15px] font-medium", state === "error" ? "text-foreground" : "text-muted-foreground")}>{title}</p>
      {detail ? <p className="max-w-md text-sm text-muted-foreground">{detail}</p> : null}
      {state === "error" && onRetry ? (
        <button type="button" onClick={onRetry} className={cn(FLOOR_OUTLINE_BUTTON, "mt-2 h-11 px-4 text-sm font-medium")}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}
