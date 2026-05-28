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
  low: { bg: "bg-success/10", text: "text-success", ring: "ring-success/30", label: "Low risk" },
  moderate: { bg: "bg-warning/10", text: "text-warning", ring: "ring-warning/30", label: "Moderate" },
  high: { bg: "bg-warning/10", text: "text-warning", ring: "ring-warning/30", label: "High risk" },
  critical: { bg: "bg-destructive/10", text: "text-destructive", ring: "ring-destructive/30", label: "Critical" },
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
      "inline-flex items-center gap-1.5 rounded-full font-semibold tracking-normal ring-1",
      t.bg, t.text, t.ring, s.badge, className
    )}>
      <span className={cn("font-mono", s.score)}>{score}</span>
      {showTier && <span>{t.label}</span>}
    </span>
  );
}

export function scoreTier(score: number): "low" | "moderate" | "high" | "critical" {
  if (score >= 80) return "low";
  if (score >= 60) return "moderate";
  if (score >= 40) return "high";
  return "critical";
}
