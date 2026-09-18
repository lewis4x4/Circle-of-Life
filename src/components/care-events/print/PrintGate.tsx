"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  PRINT_NOT_RECORDED_LINE,
  describePrintError,
  recordCareEventPrint,
  type CareEventPrintKind,
} from "@/lib/care-events/print";
import type { Database } from "@/types/database";

export type PrintGateProps = {
  supabase: SupabaseClient<Database>;
  kind: CareEventPrintKind;
  careEventId?: string | null;
  facilityId?: string | null;
  from?: string | null;
  to?: string | null;
  /** Rendered only once the print has been recorded. */
  children: ReactNode;
};

/**
 * The audit event is written before the sheet renders (COL-354). If the write
 * fails the view shows one line and renders nothing else — no half sheet, and
 * no sheet whose existence Haven cannot account for.
 *
 * Recording happens once per mount. A re-print is a new visit, which is the
 * intent: every sheet that reaches a printer has its own row.
 */
export function PrintGate({ supabase, kind, careEventId, facilityId, from, to, children }: PrintGateProps) {
  const [state, setState] = useState<"recording" | "recorded" | "failed">("recording");
  const [line, setLine] = useState<string>(PRINT_NOT_RECORDED_LINE);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    let cancelled = false;
    recordCareEventPrint(supabase, { kind, careEventId, facilityId, from, to })
      .then(() => {
        if (!cancelled) setState("recorded");
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setLine(describePrintError(error));
        setState("failed");
      });
    return () => {
      cancelled = true;
    };
  }, [supabase, kind, careEventId, facilityId, from, to]);

  if (state === "recording") {
    return (
      <p role="status" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden />
        Preparing the sheet
      </p>
    );
  }

  if (state === "failed") {
    return (
      <p role="alert" className="p-6 text-base font-medium text-destructive">
        {line}
      </p>
    );
  }

  return <>{children}</>;
}
