"use client";

import { Check, type LucideIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { KIOSK_CONFIRM_RESET_MS } from "@/lib/kiosk/contract";
import { KIOSK_STAFF_COPY } from "@/lib/kiosk/screens";
import { cn } from "@/lib/utils";

import { KIOSK_ICON_TILE, KIOSK_OUTLINE_DONE } from "./kiosk-styles";

/**
 * A kiosk confirmation (DESIGN `13`, `16`, `17b`): check, title, one line, an
 * optional card, Done. Announced through role="status"; returns home after
 * five seconds whether or not anyone taps Done.
 */
export function ConfirmPanel({
  title,
  body,
  card,
  warning,
  showClearsNote = false,
  onDone,
  resetMs = KIOSK_CONFIRM_RESET_MS,
}: {
  title: string;
  body?: ReactNode;
  card?: { icon: LucideIcon; content: ReactNode };
  /** A line that must not be missed, in the warning text color. */
  warning?: string;
  showClearsNote?: boolean;
  onDone: () => void;
  resetMs?: number;
}) {
  const doneRef = useRef<HTMLButtonElement>(null);
  const onDoneRef = useRef(onDone);
  useEffect(() => {
    onDoneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    doneRef.current?.focus();
    const id = window.setTimeout(() => onDoneRef.current(), resetMs);
    return () => window.clearTimeout(id);
  }, [resetMs]);

  const CardIcon = card?.icon;
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-8 py-10 text-center">
      <div role="status" className="flex flex-col items-center gap-5">
        <span className="flex size-28 items-center justify-center rounded-full bg-chrome-primary text-chrome-foreground">
          <Check className="size-14" strokeWidth={2.5} aria-hidden />
        </span>
        <h2 className="text-[44px] font-semibold leading-tight text-foreground">{title}</h2>
        {body ? <p className="text-[21px] text-muted-foreground tabular-nums">{body}</p> : null}
        {warning ? <p className="text-lg font-semibold text-destructive">{warning}</p> : null}
        {card && CardIcon ? (
          <div className="mt-2 flex w-155 max-w-full items-center gap-4.5 rounded-[14px] border-[1.5px] border-border bg-card px-6.5 py-5.5 text-left">
            <span className={cn(KIOSK_ICON_TILE, "size-13 rounded-[12px]")}>
              <CardIcon className="size-6.5" aria-hidden />
            </span>
            <span className="text-[19px] leading-[1.4] text-foreground">{card.content}</span>
          </div>
        ) : null}
        {showClearsNote ? <p className="mt-1.5 text-[15px] text-muted-foreground">{KIOSK_STAFF_COPY.clears}</p> : null}
      </div>
      <button ref={doneRef} type="button" className={KIOSK_OUTLINE_DONE} onClick={onDone}>
        {KIOSK_STAFF_COPY.done}
      </button>
    </div>
  );
}
