"use client";

/**
 * Time Range Selector
 *
 * Dropdown component for selecting time ranges for executive dashboards.
 * Supports MTD, YTD, Last 30 Days, Last 90 Days, and Custom Range options.
 *
 * Quiet Operator treatment: solid bg-card dropdown, semantic token borders,
 * bg-primary active state, no glass/blur. Motion uses micro-duration tier.
 */

import React, { useState } from "react";
import { Calendar, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

// ── TYPES ──

export type TimeRange =
  | "mtd" // Month to Date
  | "ytd" // Year to Date
  | "30d" // Last 30 Days
  | "90d" // Last 90 Days
  | "custom"; // Custom Range

export interface TimeRangeSelectorProps {
  /** Currently selected time range */
  value?: TimeRange;
  /** Callback when time range changes */
  onChange?: (range: TimeRange, startDate?: Date, endDate?: Date) => void;
  /** Additional CSS classes */
  className?: string;
  /** Custom date range when value is "custom" */
  customRange?: { startDate: Date; endDate: Date };
}

// ── CONSTANTS ──

const TIME_RANGE_LABELS: Record<TimeRange, string> = {
  mtd: "MTD",
  ytd: "YTD",
  "30d": "Last 30 Days",
  "90d": "Last 90 Days",
  custom: "Custom Range",
};

const TIME_RANGES: TimeRange[] = ["mtd", "ytd", "30d", "90d", "custom"];

// ── MAIN COMPONENT ──

export function TimeRangeSelector({
  value = "mtd",
  onChange,
  className,
  customRange,
}: TimeRangeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [startDate, setStartDate] = useState<Date | null>(null);
  const [endDate, setEndDate] = useState<Date | null>(null);

  const handleRangeChange = (range: TimeRange) => {
    setIsOpen(false);

    if (range === "custom") {
      setShowDatePicker(true);
      if (customRange) {
        setStartDate(customRange.startDate);
        setEndDate(customRange.endDate);
      }
    } else {
      onChange?.(range);
    }
  };

  const handleCustomRangeApply = () => {
    if (startDate && endDate) {
      onChange?.("custom", startDate, endDate);
      setShowDatePicker(false);
    }
  };

  const handleCustomRangeCancel = () => {
    setShowDatePicker(false);
    setStartDate(null);
    setEndDate(null);
  };

  return (
    <div className={cn("relative", className)}>
      {/* Dropdown Trigger */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "flex items-center gap-2 px-4 py-2 text-xs font-semibold",
          "bg-card hover:bg-secondary border border-border",
          "rounded-[var(--radius)] transition-all duration-[var(--motion-duration-micro)]",
          "text-foreground",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          isOpen && "ring-2 ring-ring/50"
        )}
      >
        <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
        <span>
          {TIME_RANGE_LABELS[value]}
        </span>
        <ChevronDown
          className={cn(
            "w-3.5 h-3.5 text-muted-foreground transition-transform duration-[var(--motion-duration-micro)]",
            isOpen && "rotate-180"
          )}
        />
      </button>

      {/* Dropdown Menu */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40"
            onClick={() => setIsOpen(false)}
          />

          {/* Menu */}
          <div className="absolute top-full left-0 mt-2 z-50 min-w-[160px]">
            <div className="bg-card border border-border rounded-[var(--radius)] shadow-[var(--shadow-lift)] overflow-hidden">
              {TIME_RANGES.map((range) => (
                <button
                  key={range}
                  onClick={() => handleRangeChange(range)}
                  className={cn(
                    "w-full px-4 py-2 text-left text-xs font-semibold transition-colors duration-[var(--motion-duration-micro)]",
                    "text-foreground",
                    "hover:bg-secondary",
                    value === range && "bg-primary/10 text-primary"
                  )}
                >
                  {TIME_RANGE_LABELS[range]}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      {/* Custom Date Range Picker */}
      {showDatePicker && (
        <>
          {/* Backdrop — warm near-black scrim, no blur */}
          <div
            className="fixed inset-0 z-50 bg-[color:var(--overlay)]"
            onClick={handleCustomRangeCancel}
          />

          {/* Date Picker Modal */}
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <div
              className="bg-card border border-border rounded-[var(--radius)] shadow-[var(--shadow-lift)] p-6 max-w-md w-full"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-sm font-semibold text-card-foreground mb-4">
                Custom Date Range
              </h3>

              <div className="space-y-4 mb-6">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    Start Date
                  </label>
                  <input
                    type="date"
                    value={startDate ? startDate.toISOString().split('T')[0] : ''}
                    onChange={(e) => setStartDate(new Date(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-background border border-input rounded-[var(--radius)] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">
                    End Date
                  </label>
                  <input
                    type="date"
                    value={endDate ? endDate.toISOString().split('T')[0] : ''}
                    onChange={(e) => setEndDate(new Date(e.target.value))}
                    className="w-full px-3 py-2 text-sm bg-background border border-input rounded-[var(--radius)] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={handleCustomRangeCancel}
                  className="px-4 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground transition-colors duration-[var(--motion-duration-micro)]"
                >
                  Cancel
                </button>
                <button
                  onClick={handleCustomRangeApply}
                  disabled={!startDate || !endDate}
                  className={cn(
                    "px-4 py-2 text-xs font-semibold rounded-[var(--radius)] transition-colors duration-[var(--motion-duration-micro)]",
                    startDate && endDate
                      ? "bg-primary hover:bg-primary/80 text-primary-foreground"
                      : "bg-muted text-muted-foreground cursor-not-allowed"
                  )}
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── UTILITY FUNCTIONS ──

/**
 * Get date range for a time range option
 */
export function getDateRange(
  range: TimeRange,
  customStart?: Date,
  customEnd?: Date
): { startDate: Date; endDate: Date } {
  const now = new Date();
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);

  switch (range) {
    case "mtd":
      const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      return { startDate: startOfMonth, endDate: endOfDay };

    case "ytd":
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      return { startDate: startOfYear, endDate: endOfDay };

    case "30d":
      const thirtyDaysAgo = new Date(now);
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      return { startDate: thirtyDaysAgo, endDate: endOfDay };

    case "90d":
      const ninetyDaysAgo = new Date(now);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
      return { startDate: ninetyDaysAgo, endDate: endOfDay };

    case "custom":
      return {
        startDate: customStart || now,
        endDate: customEnd || endOfDay,
      };

    default:
      return { startDate: now, endDate: endOfDay };
  }
}

/**
 * Format date range for display
 */
export function formatDateRange(startDate: Date, endDate: Date): string {
  const options: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    year: "numeric",
  };

  if (startDate.toDateString() === endDate.toDateString()) {
    return startDate.toLocaleDateString("en-US", options);
  }

  return `${startDate.toLocaleDateString("en-US", options)} - ${endDate.toLocaleDateString("en-US", options)}`;
}

export default TimeRangeSelector;
