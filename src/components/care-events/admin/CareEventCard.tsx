"use client";

import { Check, Loader2, Phone } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  NO_PHONE_ON_FILE_LABEL,
  acknowledgedByLine,
  callReporterLabel,
  formatClockTime,
  formatTimeSince,
  loweredLevelLine,
} from "@/lib/care-events/admin-copy";
import type { CareEventAdminCard } from "@/lib/care-events/admin-data";
import { formatLevelWord, type IncidentLevelNumber } from "@/lib/incidents/incidents-display-copy";
import { cn } from "@/lib/utils";

import { CareEventPhotos } from "./CareEventPhotos";

/** Level tone by value: 1 neutral, 2 info, 3 warning, 4 destructive. */
export function levelBadgeClass(level: IncidentLevelNumber): string {
  switch (level) {
    case 4:
      return "border-destructive/30 bg-destructive/10 text-destructive";
    case 3:
      return "border-warning/30 bg-warning/10 text-warning";
    case 2:
      return "border-info/30 bg-info/10 text-info";
    default:
      return "border-border bg-muted text-muted-foreground";
  }
}

export type CareEventCardProps = {
  card: CareEventAdminCard;
  nowMs: number;
  acknowledging: boolean;
  onAcknowledge: () => void;
};

/**
 * The push notification opens this: resident, tile word, level word, the
 * factual sentence, reporter, time since, photos, and the two buttons.
 */
export function CareEventCard({ card, nowMs, acknowledging, onAcknowledge }: CareEventCardProps) {
  const open = card.status === "open";
  const phoneHref = card.reporter.phone ? `tel:${card.reporter.phone.replace(/[^\d+]/g, "")}` : null;
  const reporterName = card.reporter.fullName?.trim() || "Staff";
  const lowered = card.level < card.derivedLevel;

  return (
    <section aria-label="Care event" className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          {card.resident ? (
            <Link href={`/admin/residents/${card.resident.id}`} className="text-lg font-semibold text-foreground hover:underline">
              {card.resident.name}
            </Link>
          ) : (
            <p className="text-lg font-semibold text-foreground">No resident (building event)</p>
          )}
          {card.resident ? <p className="text-sm text-muted-foreground">Room {card.resident.roomLabel}</p> : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{card.tileWord}</Badge>
          <Badge variant="outline" className={levelBadgeClass(card.level)}>
            {formatLevelWord(card.level)}
          </Badge>
        </div>
      </div>

      <p className="mt-4 text-base text-foreground">{card.sentence}</p>
      {card.note ? <p className="mt-2 text-sm text-muted-foreground">Staff note: {card.note}</p> : null}
      {lowered ? (
        <p className="mt-2 text-sm text-muted-foreground">{loweredLevelLine(card.derivedLevel, card.level, card.levelChangeReason)}</p>
      ) : null}

      <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Reported by</dt>
          <dd className="text-foreground">{reporterName}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Reported</dt>
          <dd className="text-foreground">
            {formatTimeSince(card.createdAt, nowMs)}
            {formatClockTime(card.occurredAt, card.timeZone) ? (
              <span className="text-muted-foreground"> (happened {formatClockTime(card.occurredAt, card.timeZone)})</span>
            ) : null}
          </dd>
        </div>
        {card.incident ? (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Incident</dt>
            <dd>
              <Link href={`/admin/incidents/${card.incident.id}`} className="text-foreground underline-offset-4 hover:underline">
                {card.incident.incidentNumber}
              </Link>
            </dd>
          </div>
        ) : null}
      </dl>

      <div className="mt-4">
        <CareEventPhotos paths={card.attachments} />
      </div>

      <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center">
        {open ? (
          <Button type="button" size="lg" className="min-h-12 sm:min-w-40" disabled={acknowledging} onClick={onAcknowledge}>
            {acknowledging ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Check className="size-4" aria-hidden />}
            I&apos;ve got it
          </Button>
        ) : (
          <p role="status" className="inline-flex min-h-12 items-center gap-2 text-sm font-medium text-success">
            <Check className="size-4" aria-hidden />
            {acknowledgedByLine(card.acknowledgedByName, card.acknowledgedAt, card.timeZone)}
          </p>
        )}
        {phoneHref ? (
          <a href={phoneHref} className={cn(buttonVariants({ variant: "outline", size: "lg" }), "min-h-12 sm:min-w-40")}>
            <Phone className="size-4" aria-hidden />
            {callReporterLabel(card.reporter.firstName)}
          </a>
        ) : (
          <Button type="button" variant="outline" size="lg" className="min-h-12 sm:min-w-40" disabled>
            <Phone className="size-4" aria-hidden />
            {NO_PHONE_ON_FILE_LABEL}
          </Button>
        )}
      </div>
    </section>
  );
}
