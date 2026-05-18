"use client";

import * as React from "react";

import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export type DateTimePickerProps = {
  id: string;
  value: string;
  onValueChange: (value: string) => void;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  className?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

function splitDateTime(value: string) {
  if (!value) return { date: "", time: "" };
  const [date = "", rawTime = ""] = value.split("T");
  return { date: date.slice(0, 10), time: rawTime.slice(0, 5) };
}

function combine(date: string, time: string) {
  if (!date) return "";
  return `${date}T${time || "00:00"}`;
}

/**
 * Date + time picker for workflow forms. It never fills today's date by itself;
 * consumers must pass a concrete value when a default is clinically intentional.
 */
export function DateTimePicker({
  id,
  value,
  onValueChange,
  disabled,
  required,
  placeholder = "Open-ended",
  className,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: DateTimePickerProps) {
  const { date, time } = splitDateTime(value);
  const timeId = `${id}-time`;

  return (
    <div className={cn("grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px]", className)}>
      <DatePicker
        id={id}
        value={date}
        onValueChange={(nextDate) => onValueChange(combine(nextDate, time))}
        disabled={disabled}
        calendarIconAlign="end"
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      <Input
        id={timeId}
        type="time"
        value={time}
        disabled={disabled || !date}
        required={required && Boolean(date)}
        aria-label={`${placeholder} time`}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onChange={(event) => onValueChange(combine(date, event.target.value))}
        className={cn(!date && "text-muted-foreground")}
      />
    </div>
  );
}
