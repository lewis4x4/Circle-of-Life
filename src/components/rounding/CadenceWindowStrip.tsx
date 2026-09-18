"use client";

/**
 * The 24 hour window strip, spec 25A section 6.6.
 *
 * Every window is drawn with its grace span, overlaps in red, and the largest
 * span in which nobody looks at a resident labeled. All of the geometry arrives
 * from `public.cadence_version_day_shape`: this component positions what it is
 * given and computes nothing, so the strip and the validation that blocks a
 * change cannot disagree.
 *
 * Semantic color only. An overlap is destructive because it is a defect that
 * silently inflates compliance; the largest gap is a warning tone because it is
 * a judgment call an administrator is allowed to make.
 */

import {
  formatMinuteOfDay,
  formatSpanMinutes,
  stripPercent,
  stripSegments,
  type CadenceDayShape,
  type CadenceShift,
} from "@/lib/rounding/cadence-settings";
import { cn } from "@/lib/utils";

const HOUR_TICKS = [0, 6, 12, 18] as const;

export function CadenceWindowStrip({
  shape,
  shifts,
  label,
}: {
  shape: CadenceDayShape;
  shifts: CadenceShift[];
  label: string;
}) {
  const enabled = shape.windows.filter((window) => window.enabled);
  const gapStart = shape.largest_gap_starts_minute;
  const gapEnd = shape.largest_gap_ends_minute;

  return (
    <section aria-label={label} className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-foreground">{label}</h3>
        <p className="text-[13px] text-muted-foreground">
          {enabled.length} checks per resident per day, longest unobserved span{" "}
          {formatSpanMinutes(shape.largest_unobserved_gap_minutes)}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4">
        <div className="relative h-16 w-full rounded-md bg-muted/40">
          {/* The largest unobserved span, drawn behind the windows. */}
          {gapStart != null && gapEnd != null
            ? stripSegments({
                window_key: "gap",
                label: "gap",
                shift_key: "",
                enabled: true,
                due_minute: gapStart,
                opens_minute: gapStart,
                closes_minute: gapEnd,
                grace_before_minutes: 0,
                grace_after_minutes: 0,
                overlaps_window_keys: [],
              }).map((segment, index) => (
                <div
                  key={`gap-${index}`}
                  aria-hidden
                  className="absolute inset-y-0 border-x border-warning/40 bg-warning/10"
                  style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
                />
              ))
            : null}

          {/* Shift boundaries, read from the shift model rather than assumed. */}
          {shifts.map((shift) => (
            <div
              key={shift.shift_key}
              aria-hidden
              title={`${shift.label} shift starts`}
              className="absolute inset-y-0 w-px bg-[var(--border-strong)]"
              style={{ left: `${stripPercent(shift.starts_minute)}%` }}
            />
          ))}

          {enabled.map((window) => {
            const overlapping = window.overlaps_window_keys.length > 0;
            return stripSegments(window).map((segment, index) => (
              <div
                key={`${window.window_key}-${index}`}
                title={`${window.label}, open ${formatMinuteOfDay(window.opens_minute)} to ${formatMinuteOfDay(
                  window.closes_minute,
                )}`}
                className={cn(
                  "absolute top-3 h-10 rounded-sm border",
                  overlapping
                    ? "border-destructive/50 bg-destructive/25"
                    : "border-primary/40 bg-primary/20",
                )}
                style={{ left: `${segment.leftPercent}%`, width: `${segment.widthPercent}%` }}
              />
            ));
          })}

          {enabled.map((window) => (
            <div
              key={`${window.window_key}-due`}
              aria-hidden
              className="absolute top-2 h-12 w-0.5 bg-primary"
              style={{ left: `${stripPercent(window.due_minute)}%` }}
            />
          ))}
        </div>

        <div className="relative mt-1 h-4">
          {HOUR_TICKS.map((hour) => (
            <span
              key={hour}
              className="absolute text-[11px] tabular-nums text-muted-foreground"
              style={{ left: `${stripPercent(hour * 60)}%` }}
            >
              {formatMinuteOfDay(hour * 60)}
            </span>
          ))}
        </div>

        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          {enabled.map((window) => (
            <div key={window.window_key} className="flex items-baseline justify-between gap-3 py-1">
              <dt className="text-foreground">
                {window.label}
                {window.overlaps_window_keys.length > 0 ? (
                  <span className="ml-2 text-destructive">overlaps another check</span>
                ) : null}
              </dt>
              <dd className="tabular-nums text-muted-foreground">
                {formatMinuteOfDay(window.due_minute)} ({formatMinuteOfDay(window.opens_minute)} to{" "}
                {formatMinuteOfDay(window.closes_minute)})
              </dd>
            </div>
          ))}
        </dl>

        {gapStart != null && gapEnd != null ? (
          <p className="mt-3 text-[13px] text-muted-foreground">
            Nobody looks at a resident between {formatMinuteOfDay(gapStart)} and{" "}
            {formatMinuteOfDay(gapEnd)}, which is {formatSpanMinutes(shape.largest_unobserved_gap_minutes)}.
          </p>
        ) : null}
      </div>
    </section>
  );
}
