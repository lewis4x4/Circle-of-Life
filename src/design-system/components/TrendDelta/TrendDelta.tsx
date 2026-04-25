import { cn } from "@/lib/utils";

export type TrendDirection = "up" | "down" | "flat";
export type TrendUnit = "pp" | "pts" | "%" | "days";

export type TrendDeltaProps = {
  direction: TrendDirection;
  value: number;
  unit: TrendUnit;
  period: string;
  goodDirection?: "up" | "down";
  className?: string;
};

const ARROWS: Record<TrendDirection, string> = {
  up: "↑",
  down: "↓",
  flat: "→",
};

const DIRECTION_LABEL: Record<TrendDirection, string> = {
  up: "up",
  down: "down",
  flat: "unchanged",
};

export function TrendDelta({
  direction,
  value,
  unit,
  period,
  goodDirection,
  className,
}: TrendDeltaProps) {
  const tone = resolveTone(direction, goodDirection);
  const absValue = Math.abs(value);
  const accessible = `${DIRECTION_LABEL[direction]} ${absValue}${unit} ${period}`;
  const toneClass =
    tone === "success"
      ? "text-success"
      : tone === "danger"
        ? "text-danger"
        : "text-text-muted";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 tabular-nums text-xs font-medium",
        toneClass,
        className,
      )}
      aria-label={accessible}
      data-direction={direction}
      data-tone={tone}
    >
      <span aria-hidden="true">{ARROWS[direction]}</span>
      <span>
        {absValue}
        {unit}
      </span>
      <span className="text-text-muted">{period}</span>
    </span>
  );
}

function resolveTone(
  direction: TrendDirection,
  goodDirection?: "up" | "down",
): "success" | "danger" | "muted" {
  if (direction === "flat") return "muted";
  if (!goodDirection) return "muted";
  return direction === goodDirection ? "success" : "danger";
}
