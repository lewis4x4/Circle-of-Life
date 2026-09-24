"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check, Phone } from "lucide-react";

import { RECEIPT_OFFLINE_SAVED_LINE, onCallLine } from "@/lib/care-events/receipt-copy";
import type { AnswerLine } from "@/lib/floor/report-adapter";
import { cn } from "@/lib/utils";

import { FLOOR_OUTLINE_BUTTON, FLOOR_PRIMARY_BUTTON } from "./floor-styles";

/**
 * The receipt in the tablet layout (DESIGN.md 07b): check, "Report sent", the
 * answers, where it went, Start over and Back to Now. Saved offline, it says so
 * instead, and an Urgent or Emergency event shows the on-call phone.
 */
export function reportSentAnnouncement(offline: boolean): string {
  return offline ? "Saved on this tablet." : "Report sent.";
}

export function FloorReportSent({
  answers,
  offline,
  level,
  onCallPhone,
  onStartOver,
}: {
  answers: readonly AnswerLine[];
  offline: boolean;
  level: number;
  onCallPhone: string | null;
  onStartOver: () => void;
}) {
  // The report screen's persistent live region announces the result; focus
  // moves here so the next tap starts from the receipt, not a vanished button.
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-4.5 overflow-y-auto px-6 py-8">
      <span className="flex size-22 items-center justify-center rounded-full border-2 border-primary" aria-hidden>
        <Check className="size-11 text-primary" />
      </span>
      <h2 ref={headingRef} tabIndex={-1} className="text-center text-[32px] font-semibold text-foreground focus:outline-none">{reportSentAnnouncement(offline).replace(/\.$/, "")}</h2>
      <dl className="w-140 max-w-full rounded-[12px] border border-border bg-card px-5 py-2">
        {answers.map((line) => (
          <div key={line.prompt} className="flex justify-between gap-4 border-b border-border py-2.5 last:border-b-0">
            <dt className="text-sm text-muted-foreground">{line.prompt}</dt>
            <dd className="text-right text-[15px] font-semibold text-foreground">{line.answer}</dd>
          </div>
        ))}
      </dl>
      <p className="text-center text-sm text-muted-foreground">
        {offline ? RECEIPT_OFFLINE_SAVED_LINE : "It is on the administrator's Home now. You can add a note from Report."}
      </p>
      {offline && level >= 3 ? (
        <div className="flex w-140 max-w-full flex-col gap-3 rounded-[8px] border border-destructive/50 bg-destructive/10 px-4 py-4">
          <p className="text-base font-semibold text-foreground">{onCallLine(onCallPhone)}</p>
          {onCallPhone ? (
            <a
              href={`tel:${onCallPhone.replace(/[^+\d]/g, "")}`}
              className="flex h-14 items-center justify-center gap-2 rounded-[8px] bg-destructive px-4 text-base font-semibold text-destructive-foreground"
            >
              <Phone className="size-5" aria-hidden />
              Call the on-call phone
            </a>
          ) : null}
        </div>
      ) : null}
      <div className="flex gap-3">
        <button type="button" onClick={onStartOver} className={cn(FLOOR_OUTLINE_BUTTON, "h-13 rounded-[10px] px-5 text-base")}>
          Start over
        </button>
        <Link href="/floor" className={cn(FLOOR_PRIMARY_BUTTON, "h-13 rounded-[10px] px-6.5 text-base")}>
          Back to Now
        </Link>
      </div>
    </div>
  );
}
