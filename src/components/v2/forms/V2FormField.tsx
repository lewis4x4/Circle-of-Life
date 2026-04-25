"use client";

import { type ReactNode } from "react";

import { cn } from "@/lib/utils";

export type V2FormFieldProps = {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
};

/**
 * Shared field row used by V2 forms — keeps label/hint/error styling
 * consistent across NewResident / NewAdmission / NewIncident skeletons.
 */
export function V2FormField({
  id,
  label,
  hint,
  error,
  children,
  className,
}: V2FormFieldProps) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <label
      htmlFor={id}
      className={cn("flex flex-col gap-1", className)}
    >
      <span className="text-xs font-semibold uppercase tracking-caps text-text-muted">
        {label}
      </span>
      <div aria-describedby={errorId ?? hintId}>{children}</div>
      {hint && !error && (
        <span id={hintId} className="text-xs text-text-muted">
          {hint}
        </span>
      )}
      {error && (
        <span id={errorId} role="alert" className="text-xs text-danger">
          {error}
        </span>
      )}
    </label>
  );
}
