import { cn } from "@/lib/utils";

export type SeverityLevel = "low" | "medium" | "high";

export type SeverityChipProps = {
  level: SeverityLevel;
  trend?: {
    from: SeverityLevel;
    ageText: string;
  };
  className?: string;
};

const LEVEL_TO_LABEL: Record<SeverityLevel, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

const LEVEL_RANK: Record<SeverityLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

const LEVEL_TO_DOT: Record<SeverityLevel, string> = {
  low: "bg-success",
  medium: "bg-warning",
  high: "bg-danger",
};

const LEVEL_TO_TEXT: Record<SeverityLevel, string> = {
  low: "text-success",
  medium: "text-warning",
  high: "text-danger",
};

export function SeverityChip({ level, trend, className }: SeverityChipProps) {
  const arrow = trend ? trendArrow(trend.from, level) : null;
  const trendLabel = trend
    ? `${arrow === "↑" ? "up" : arrow === "↓" ? "down" : "unchanged"} from ${LEVEL_TO_LABEL[trend.from]} ${trend.ageText}`
    : undefined;

  return (
    <span
      role="status"
      data-level={level}
      aria-label={
        trend
          ? `Severity ${LEVEL_TO_LABEL[level]}, ${trendLabel}`
          : `Severity ${LEVEL_TO_LABEL[level]}`
      }
      className={cn(
        "inline-flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1 text-xs font-semibold",
        LEVEL_TO_TEXT[level],
        className,
      )}
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", LEVEL_TO_DOT[level])} />
      <span>{LEVEL_TO_LABEL[level]}</span>
      {trend && (
        <span className="text-text-muted">
          <span aria-hidden="true">{arrow} </span>
          from {LEVEL_TO_LABEL[trend.from]} {trend.ageText}
        </span>
      )}
    </span>
  );
}

function trendArrow(from: SeverityLevel, current: SeverityLevel): "↑" | "↓" | "→" {
  const delta = LEVEL_RANK[current] - LEVEL_RANK[from];
  if (delta > 0) return "↑";
  if (delta < 0) return "↓";
  return "→";
}
