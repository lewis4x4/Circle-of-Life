"use client";

import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

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
  const describedBy = errorId ?? hintId;
  // The control carries `id`; describe it directly (COL-658). A describedby on
  // a wrapper div is never announced.
  const control =
    describedBy && isValidElement(children)
      ? cloneElement(children as ReactElement<{ "aria-describedby"?: string }>, {
          "aria-describedby":
            (children as ReactElement<{ "aria-describedby"?: string }>).props["aria-describedby"] ?? describedBy,
        })
      : children;

  // A <div>, not a wrapping <label>: children may bring their own label (a
  // checkbox row), and nested labels are invalid and name the control twice.
  return (
    <div className={cn("flex flex-col gap-1", className)}>
      <label htmlFor={id} className="text-xs font-semibold uppercase tracking-caps text-text-muted">
        {label}
      </label>
      {control}
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
    </div>
  );
}
