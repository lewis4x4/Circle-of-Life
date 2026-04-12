"use client";

import { cn } from "@/lib/utils";

interface SafetyScoreBadgeProps {
  score: number;
  tier: "low" | "moderate" | "high" | "critical";
  size?: "sm" | "md" | "lg";
  showTier?: boolean;
  className?: string;
}

const TIER_STYLES = {
  low: { bg: "bg-emerald-500/20", text: "text-emerald-400", ring: "ring-emerald-500/30", label: "LOW RISK" },
  moderate: { bg: "bg-amber-500/20", text: "text-amber-400", ring: "ring-amber-500/30", label: "MODERATE" },
  high: { bg: "bg-orange-500/20", text: "text-orange-400", ring: "ring-orange-500/30", label: "HIGH RISK" },
  critical: { bg: "bg-rose-500/20", text: "text-rose-400", ring: "ring-rose-500/30", label: "CRITICAL" },
};

const SIZE_STYLES = {
  sm: { badge: "px-2 py-0.5 text-[10px]", score: "text-xs" },
  md: { badge: "px-2.5 py-1 text-xs", score: "text-sm" },
  lg: { badge: "px-3 py-1.5 text-sm", score: "text-base" },
};

export function SafetyScoreBadge({ score, tier, size = "md", showTier = true, className }: SafetyScoreBadgeProps) {
  const t = TIER_STYLES[tier];
  const s = SIZE_STYLES[size];

  return (
    <span className={cn(
      "inline-flex items-center gap-1.5 rounded-full font-bold tracking-wider ring-1",
      t.bg, t.text, t.ring, s.badge, className
    )}>
      <span className={cn("font-mono", s.score)}>{score}</span>
      {showTier && <span className="uppercase">{t.label}</span>}
    </span>
  );
}

export function scoreTier(score: number): "low" | "moderate" | "high" | "critical" {
  if (score >= 80) return "low";
  if (score >= 60) return "moderate";
  if (score >= 40) return "high";
  return "critical";
}
