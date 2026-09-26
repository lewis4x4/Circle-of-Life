"use client";

import { useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils";

import { KIOSK_PRIMARY, KIOSK_SECONDARY } from "./kiosk-styles";

/**
 * A kiosk yes-or-no sheet: one question, Cancel and the action, 72 px each.
 * Modal to assistive technology; Escape and Cancel close it; the action has
 * focus so one more tap finishes.
 */
export function KioskConfirmSheet({
  title,
  confirmLabel,
  cancelLabel,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement>(null);
  const onCancelRef = useRef(onCancel);
  useEffect(() => {
    onCancelRef.current = onCancel;
  }, [onCancel]);

  useEffect(() => {
    confirmRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelRef.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 motion-safe:animate-in motion-safe:fade-in-0">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex w-full max-w-205 flex-col gap-7 rounded-t-[20px] border-[1.5px] border-b-0 border-border bg-card px-10 pb-10 pt-8"
      >
        <h2 id={titleId} className="text-[34px] font-semibold leading-tight text-foreground">
          {title}
        </h2>
        <div className="grid grid-cols-2 gap-4">
          <button type="button" className={cn(KIOSK_SECONDARY, "h-18")} onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button ref={confirmRef} type="button" className={cn(KIOSK_PRIMARY, "h-18")} onClick={onConfirm} disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
