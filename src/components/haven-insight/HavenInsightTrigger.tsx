"use client";

import React from "react";
import { MessageSquare } from "lucide-react";
import { useHavenInsight } from "@/lib/haven-insight/HavenInsightContext";

export function HavenInsightTrigger() {
  const { toggle, isOpen } = useHavenInsight();

  return (
    <button
      onClick={toggle}
      aria-label="Toggle Haven Insight"
      className={`fixed bottom-6 right-6 z-[59] flex size-11 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-[var(--shadow-card)] transition-colors hover:bg-muted/40 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:ring-offset-background ${
        isOpen
          ? "opacity-60"
          : ""
      }`}
    >
      <MessageSquare className="size-4" />
    </button>
  );
}
