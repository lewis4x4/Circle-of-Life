"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";

import { Button } from "@/components/ui/button";
import { formatCents } from "@/lib/home/record-payment";
import { pastDueRuleClause, pastDueTotalCents, type HomePastDue } from "@/lib/home/past-due";
import { cn } from "@/lib/utils";

import { CARD_CLASS, CARD_HEAD_CLASS } from "./home-styles";

export type PastDueStripProps = {
  pastDue: HomePastDue | null;
  /** When Record payment is also released, each name offers it directly. */
  onRecordPayment?: (residentId: string) => void;
  /** When the collections contact log is released, each name offers it (COL-595). */
  onLogContact?: (residentId: string, name: string) => void;
};

/**
 * Past-due rent on Home (COL-594): count and total on the strip, names only
 * after a tap. Rendered only when the past_due module is released for the
 * facility; an unconfigured facility says so instead of reading as clear.
 */
export function PastDueStrip({ pastDue, onRecordPayment, onLogContact }: PastDueStripProps) {
  const [open, setOpen] = useState(false);
  if (!pastDue) {
    return (
      <section id="past-due" className={cn(CARD_CLASS, "mb-4 px-4 py-3 text-xs text-muted-foreground")} aria-label="Rent past due">
        Past-due rent is unavailable right now.
      </section>
    );
  }
  if (!pastDue.configured) {
    return (
      <section id="past-due" className={cn(CARD_CLASS, "mb-4 px-4 py-3 text-xs text-muted-foreground")} aria-label="Rent past due" data-testid="past-due-unconfigured">
        Rent terms (due day and grace days) are not set for this building yet, so nobody is shown as past due.
      </section>
    );
  }
  const count = pastDue.residents.length;
  return (
    <section id="past-due" className={cn(CARD_CLASS, "mb-4 overflow-hidden")} aria-labelledby="past-due-heading" data-testid="past-due-strip">
      <div className={CARD_HEAD_CLASS}>
        <div>
          <h2 id="past-due-heading" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
            <CreditCard className="size-4 text-muted-foreground" aria-hidden /> Rent past due
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {count === 0
              ? "Nobody is past due."
              : `${count} ${count === 1 ? "resident" : "residents"} · ${formatCents(pastDueTotalCents(pastDue))} open · ${pastDueRuleClause(pastDue)}`}
          </p>
        </div>
        {count > 0 ? (
          <Button type="button" variant="ghost" size="sm" aria-expanded={open} aria-controls="past-due-list" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide names" : "Show names"}
          </Button>
        ) : null}
      </div>
      {open && count > 0 ? (
        <ul id="past-due-list" className="list-none">
          {pastDue.residents.map((resident) => (
            <li key={resident.residentId} className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 text-[13px]">
              <span className="text-foreground">
                {resident.name}
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {resident.daysPastDue} days · {formatCents(resident.openCents)}
                </span>
              </span>
              <span className="flex gap-1.5">
                {onLogContact ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => onLogContact(resident.residentId, resident.name)}>Log contact</Button>
                ) : null}
                {onRecordPayment ? (
                  <Button type="button" variant="outline" size="sm" onClick={() => onRecordPayment(resident.residentId)}>Record payment</Button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
