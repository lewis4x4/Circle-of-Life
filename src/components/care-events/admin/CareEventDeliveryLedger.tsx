"use client";

import { deliveryLedgerWords, type CareEventDeliveryLine } from "@/lib/care-events/admin-data";
import { cn } from "@/lib/utils";

export type CareEventDeliveryLedgerProps = {
  rows: readonly CareEventDeliveryLine[];
  timeZone: string;
  /** Loading and error are the caller's state machine; the ledger only renders rows. */
  emptyLine?: string;
};

const STATUS_TONE: Record<string, string> = {
  acknowledged: "text-success",
  failed: "text-destructive",
  skipped: "text-muted-foreground",
};

/**
 * Who was told, how, and when. One row per care_event_deliveries entry, in
 * escalation order. Shared by the care event card and the incident detail.
 */
export function CareEventDeliveryLedger({ rows, timeZone, emptyLine }: CareEventDeliveryLedgerProps) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {emptyLine ?? "Nobody has been alerted for this event yet."}
      </p>
    );
  }
  return (
    <ul className="divide-y divide-border" aria-label="Delivery ledger">
      {rows.map((row) => {
        const words = deliveryLedgerWords(row, timeZone);
        return (
          <li key={row.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2 text-sm">
            <div className="min-w-0">
              <span className="font-medium text-foreground">{words.target}</span>
              <span className="text-muted-foreground"> by {words.channel.toLowerCase()}</span>
              {row.step > 0 ? <span className="text-muted-foreground"> (escalation step {row.step})</span> : null}
              {words.note ? <p className="text-xs text-muted-foreground">{words.note}</p> : null}
            </div>
            <div className="flex items-baseline gap-2 tabular-nums">
              <span className={cn("font-medium", STATUS_TONE[row.status] ?? "text-foreground")}>{words.status}</span>
              {words.time ? <span className="text-muted-foreground">{words.time}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
