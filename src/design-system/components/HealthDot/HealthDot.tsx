import { cn } from "@/lib/utils";
import { resolveHealthBand, type HealthDotTone } from "./bands";

export type HealthDotProps = {
  score: number;
  max?: number;
  className?: string;
  ariaLabel?: string;
};

const TONE_TO_DOT: Record<HealthDotTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

const TONE_TO_BAR: Record<HealthDotTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-danger",
};

export function HealthDot({ score, max = 100, className, ariaLabel }: HealthDotProps) {
  const clamped = Math.max(0, Math.min(score, max));
  const pct = max === 0 ? 0 : Math.round((clamped / max) * 100);
  const tone = resolveHealthBand(clamped, max);
  const label = ariaLabel ?? `Health score ${clamped} of ${max}`;

  return (
    <div
      role="img"
      aria-label={label}
      data-tone={tone}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span aria-hidden="true" className={cn("h-2 w-2 rounded-full", TONE_TO_DOT[tone])} />
      <span
        aria-hidden="true"
        className="relative h-1.5 w-16 rounded-full bg-surface-elevated overflow-hidden"
      >
        <span
          className={cn("absolute inset-y-0 left-0 rounded-full", TONE_TO_BAR[tone])}
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="tabular-nums text-xs font-semibold text-text-primary">
        {clamped}
      </span>
    </div>
  );
}
