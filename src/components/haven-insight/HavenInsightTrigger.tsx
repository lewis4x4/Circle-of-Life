"use client";

import React from "react";
import { Brain } from "lucide-react";
import { useHavenInsight } from "@/lib/haven-insight/HavenInsightContext";

export function HavenInsightTrigger() {
  const { toggle, isOpen } = useHavenInsight();

  return (
    <button
      onClick={toggle}
      aria-label="Toggle Haven Insight"
      className={`fixed bottom-6 right-6 z-[59] w-12 h-12 rounded-full flex items-center justify-center transition-all duration-300 shadow-lg ${
        isOpen
          ? "bg-slate-800 shadow-none scale-90 opacity-60"
          : "bg-gradient-to-br from-violet-600 to-indigo-600 shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] hover:scale-105"
      }`}
    >
      <Brain className="w-5 h-5 text-white" />
    </button>
  );
}
