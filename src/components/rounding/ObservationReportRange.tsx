"use client";

/**
 * The report's date range, as its own control block.
 *
 * Split out of the reports page so both stay inside the constitution's
 * component budget. The date fields are the `DatePicker` primitive rather than
 * a native date input, which the constitution requires and the constitution
 * lint enforces.
 */

import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { FormLabel } from "@/components/ui/form-label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FileBarChart } from "lucide-react";
import type { DateRangePreset } from "@/lib/rounding/rounding-reports-date-range";

const PRESETS: Array<{ value: DateRangePreset; label: string }> = [
  { value: "last_7", label: "Last 7 days" },
  { value: "last_30", label: "Last 30 days" },
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "quarter_to_date", label: "Quarter to date" },
  { value: "custom", label: "Custom range" },
];

export function ObservationReportRange({
  preset,
  from,
  to,
  busy,
  onPresetChange,
  onFromChange,
  onToChange,
  onBuild,
}: {
  preset: DateRangePreset;
  from: string;
  to: string;
  busy: boolean;
  onPresetChange: (next: DateRangePreset) => void;
  onFromChange: (next: string) => void;
  onToChange: (next: string) => void;
  onBuild: () => void;
}) {
  return (
    <section aria-label="Report range">
      <div className="grid grid-cols-1 gap-4 rounded-lg border border-border bg-card p-4 lg:grid-cols-4">
        <div className="space-y-2">
          <FormLabel htmlFor="report-preset">Date range</FormLabel>
          <Select value={preset} onValueChange={(value) => onPresetChange(value as DateRangePreset)}>
            <SelectTrigger id="report-preset" className="h-10">
              <SelectValue placeholder="Select range" />
            </SelectTrigger>
            <SelectContent>
              {PRESETS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <FormLabel htmlFor="report-from">From (ET)</FormLabel>
          <DatePicker
            id="report-from"
            value={from}
            onValueChange={onFromChange}
            calendarIconAlign="end"
          />
        </div>
        <div className="space-y-2">
          <FormLabel htmlFor="report-to">To (ET)</FormLabel>
          <DatePicker
            id="report-to"
            value={to}
            onValueChange={onToChange}
            calendarIconAlign="end"
          />
        </div>
        <div className="flex items-end">
          <Button type="button" onClick={onBuild} disabled={busy}>
            <FileBarChart className="size-4" aria-hidden />
            Build report
          </Button>
        </div>
      </div>
    </section>
  );
}
