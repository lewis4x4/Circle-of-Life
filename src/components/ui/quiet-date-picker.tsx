"use client";

import * as React from "react";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isAfter,
  isBefore,
  isSameDay,
  isSameMonth,
  parseISO,
  startOfDay,
  startOfMonth,
  startOfWeek,
  subYears,
} from "date-fns";
import { CalendarIcon } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export type QuietDatePickerMode = "dob" | "admission" | "neutral" | "move_in";

/** Canonical display token for QuietDatePicker values (slashes, spaces, monospace via class). */
export const QUIET_DATE_DISPLAY_FORMAT = "MM / dd / yyyy";

export type QuietDatePickerProps = {
  id: string;
  value: string;
  onValueChange: (isoDate: string) => void;
  disabled?: boolean;
  mode?: QuietDatePickerMode;
  /** When `"end"`, calendar icon is anchored to the right (operator date fields). */
  calendarIconAlign?: "start" | "end";
  /**
   * When `value` is empty: visible month for the popover opens on first-of-month parsed from this
   * `yyyy-MM-dd` date. If omitted, **no mode** snaps the empty picker to today's month silently:
   * `admission`, `move_in`, and `neutral` use a fixed sentinel month; `dob` anchors ~80yr ago for scanning.
   */
  initialVisibleMonthIso?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  className?: string;
};

function toIso(d: Date) {
  return format(d, "yyyy-MM-dd");
}

function parseIsoSafe(iso: string): Date | null {
  if (!iso.trim()) return null;
  try {
    return parseISO(`${iso}T12:00:00`);
  } catch {
    return null;
  }
}

/** Fixed sentinel — never imply “today” as a selected date by opening the picker on current month when empty. */
const EMPTY_MONTH_SENTINEL = new Date(2000, 0, 1);

export function formatQuietIsoForDisplay(iso: string): string {
  const d = parseIsoSafe(iso.trim());
  return d ? format(d, QUIET_DATE_DISPLAY_FORMAT) : "";
}

export function QuietDatePicker({
  id,
  value,
  onValueChange,
  disabled,
  mode = "neutral",
  calendarIconAlign = "start",
  initialVisibleMonthIso,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  className,
}: QuietDatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const selected = parseIsoSafe(value);
  const today = new Date();
  const todayDay = startOfDay(today);
  const maxDob = subYears(today, 18);
  const minDob = subYears(today, 120);

  const resolveVisibleMonthStart = React.useCallback(
    (selectedDate: Date | null) => {
      if (selectedDate) return startOfMonth(selectedDate);
      const trimmed = initialVisibleMonthIso?.trim();
      if (trimmed) {
        const custom = parseIsoSafe(trimmed.length >= 10 ? trimmed.slice(0, 10) : trimmed);
        if (custom && Number.isFinite(custom.getTime())) return startOfMonth(custom);
      }
      if (mode === "dob") return startOfMonth(subYears(new Date(), 80));
      return startOfMonth(EMPTY_MONTH_SENTINEL);
    },
    [initialVisibleMonthIso, mode],
  );

  const [visibleMonth, setVisibleMonth] = React.useState<Date>(() => resolveVisibleMonthStart(selected));

  React.useEffect(() => {
    if (open) return;
    setVisibleMonth(resolveVisibleMonthStart(selected));
  }, [open, resolveVisibleMonthStart, selected]);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) {
      setVisibleMonth(resolveVisibleMonthStart(parseIsoSafe(value.trim())));
    }
  }

  const monthStart = startOfMonth(visibleMonth);
  const monthEnd = endOfMonth(visibleMonth);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });

  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  function dayDisabled(d: Date) {
    const day = startOfDay(d);
    if (mode === "dob") {
      if (isAfter(d, maxDob)) return true;
      if (isBefore(d, minDob)) return true;
      return false;
    }
    if (mode === "admission") {
      if (isAfter(d, today)) return true;
      return false;
    }
    if (mode === "move_in") {
      if (isBefore(day, todayDay)) return true;
      return false;
    }
    return false;
  }

  const display = selected ? format(selected, QUIET_DATE_DISPLAY_FORMAT) : "";

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <div className={cn("flex gap-2", className)}>
        <PopoverTrigger
          type="button"
          id={id}
          disabled={disabled}
          data-testid={`${id}-trigger`}
          aria-invalid={ariaInvalid}
          aria-describedby={ariaDescribedBy}
          className={cn(
            buttonVariants({ variant: "outline", size: "sm" }),
            "h-10 gap-2 px-3 font-normal",
            calendarIconAlign === "end" ? "w-[200px] justify-between pr-3" : "flex-1 justify-start",
            !selected && "text-muted-foreground",
          )}
        >
          {calendarIconAlign === "start" ? (
            <>
              <CalendarIcon className="size-4 shrink-0 opacity-70" aria-hidden />
              <span className={cn("truncate font-mono text-[13px] tabular-nums tracking-normal")}>
                {display || "MM / DD / YYYY"}
              </span>
            </>
          ) : (
            <>
              <span className={cn("min-w-0 flex-1 truncate text-left font-mono text-[13px] tabular-nums tracking-normal")}>
                {display || "MM / DD / YYYY"}
              </span>
              <CalendarIcon className="size-4 shrink-0 opacity-70" aria-hidden />
            </>
          )}
        </PopoverTrigger>
      </div>
      <PopoverContent className="w-auto min-w-[280px] flex-col p-3" align="start">
        <div className="mb-3 flex items-center justify-between gap-2">
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Previous month"
            onClick={() => setVisibleMonth((m) => addMonths(m, -1))}
          >
            ‹
          </Button>
          <div className="text-center text-sm font-medium tabular-nums">{format(visibleMonth, "MMMM yyyy")}</div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8 shrink-0"
            aria-label="Next month"
            onClick={() => setVisibleMonth((m) => addMonths(m, 1))}
          >
            ›
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-1 text-center text-[11px] font-medium text-muted-foreground">
          {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
            <div key={d} className="py-1">
              {d}
            </div>
          ))}
        </div>
        <div role="grid" className="mt-1 grid grid-cols-7 gap-1">
          {weeks.map((week) =>
            week.map((d) => {
              const inMonth = isSameMonth(d, visibleMonth);
              const isSel = Boolean(selected && isSameDay(d, selected));
              const dim = dayDisabled(d);
              return (
                <button
                  key={d.toISOString()}
                  type="button"
                  role="gridcell"
                  disabled={dim}
                  onClick={() => {
                    onValueChange(toIso(d));
                    setOpen(false);
                  }}
                  className={cn(
                    "flex h-9 items-center justify-center rounded-md text-sm transition-colors",
                    !inMonth && "text-muted-foreground/40",
                    dim && "cursor-not-allowed opacity-30",
                    !dim && inMonth && "hover:bg-accent hover:text-accent-foreground",
                    isSel && "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
                  )}
                >
                  {format(d, "d")}
                </button>
              );
            }),
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
