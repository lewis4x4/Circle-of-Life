"use client";

import { forwardRef, type InputHTMLAttributes } from "react";

import { KIOSK_SIGN_IN_COPY } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

type KioskFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "id" | "className"> & {
  id: string;
  label: string;
  required?: boolean;
  /** Show "(required)" after the label, as the provider form does. */
  markRequired?: boolean;
  hint?: string;
  error?: string;
};

/** Label bound to its input, 60 px field, 20 px input text (DESIGN §1). */
export const KioskField = forwardRef<HTMLInputElement, KioskFieldProps>(function KioskField(
  { id, label, required, markRequired, hint, error, ...input },
  ref,
) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="text-[17px] font-semibold text-foreground">
        {label}
        {markRequired ? <span className="font-normal text-muted-foreground"> {KIOSK_SIGN_IN_COPY.required}</span> : null}
      </label>
      <input
        ref={ref}
        id={id}
        required={required}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        autoComplete="off"
        autoCorrect="off"
        className={cn(
          "h-15 w-full rounded-[10px] border-[1.5px] border-input bg-card px-4.5 text-xl text-foreground placeholder:text-muted-foreground",
          "focus:border-chrome-primary focus:outline-none focus-visible:ring-4 focus-visible:ring-ring/40",
          "aria-[invalid=true]:border-destructive",
        )}
        {...input}
      />
      {hint ? (
        <p id={hintId} className="text-sm text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="text-sm font-semibold text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
});
