"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { CareEventDeliveryLedger } from "@/components/care-events/admin/CareEventDeliveryLedger";
import { buttonVariants } from "@/components/ui/button";
import { formatClockTime } from "@/lib/care-events/admin-copy";
import { formatIncidentDetailTimestamp } from "@/lib/incidents/incident-detail-display-copy";
import type { IncidentDetailCareEvent, SupabaseIncidentDetail } from "@/lib/incidents/load-incident-detail";
import { cn } from "@/lib/utils";

export type IncidentCareEventNotificationsProps = {
  incident: SupabaseIncidentDetail;
  careEvent: IncidentDetailCareEvent;
  acknowledgmentLine: string | null;
  openObligations: string[];
  /** The regulatory buttons that still apply (AHCA reported, insurance reported, care plan updated). */
  actions: ReactNode;
};

function Pill({ active, label, warn }: { active: boolean; label: string; warn?: boolean }) {
  return (
    <span
      className={cn(
        "rounded-full border px-3 py-1 text-xs font-medium",
        active
          ? warn
            ? "border-warning/20 bg-warning/10 text-warning"
            : "border-success/20 bg-success/10 text-success"
          : "border-border bg-muted text-muted-foreground",
      )}
    >
      {label}
    </span>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-3">
      <span className="min-w-[8rem] text-xs font-medium text-muted-foreground">{label}</span>
      <div className="text-foreground">{value}</div>
    </div>
  );
}

/**
 * Notifications for an incident born from the three-tap flow: acknowledgment
 * is derived from care_events.acknowledged_at and the delivery ledger, never
 * from a hand-set flag (spec 07A §4, §6.3).
 */
export function IncidentCareEventNotifications({ incident, careEvent, acknowledgmentLine, openObligations, actions }: IncidentCareEventNotificationsProps) {
  const acknowledgedTime = formatClockTime(careEvent.acknowledgedAt, careEvent.timeZone);
  const acknowledgedLabel = acknowledgedTime ? `Administrator acknowledged ${acknowledgedTime}` : "Administrator not yet acknowledged";
  const acknowledgedRow = careEvent.acknowledgedAt
    ? `${formatIncidentDetailTimestamp(careEvent.acknowledgedAt)}${careEvent.acknowledgedByName ? ` by ${careEvent.acknowledgedByName}` : ""}`
    : "Not yet";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <Pill active={Boolean(careEvent.acknowledgedAt)} label={acknowledgedLabel} />
        <Pill active={incident.family_notified} label={incident.family_notified ? "Family notified" : "Family not yet notified"} />
        <Pill active={incident.ahca_reportable} label={incident.ahca_reportable ? "AHCA reportable" : "AHCA not reportable"} warn />
        <Pill active={incident.ahca_reported} label={incident.ahca_reported ? "AHCA reported" : "AHCA not reported"} />
        <Pill active={incident.insurance_reportable} label={incident.insurance_reportable ? "Insurance reportable" : "Insurance not reportable"} warn />
        <Pill active={incident.insurance_reported} label={incident.insurance_reported ? "Insurance reported" : "Insurance not reported"} />
        <Pill active={incident.care_plan_updated} label={incident.care_plan_updated ? "Care plan updated" : "Care plan not updated"} />
      </div>

      <div className="grid gap-3 text-sm sm:grid-cols-2">
        <Row label="Administrator acknowledged" value={acknowledgedRow} />
        <Row label="Physician notified" value={incident.physician_notified_at ? formatIncidentDetailTimestamp(incident.physician_notified_at) : incident.physician_notified ? "Yes" : careEvent.admin.physicianLater ? "Later" : "Pending"} />
        <Row label="Family notified" value={incident.family_notified_at ? formatIncidentDetailTimestamp(incident.family_notified_at) : incident.family_notified ? "Yes" : careEvent.admin.familyLater ? "Later" : "Pending"} />
        <Row label="AHCA reported" value={incident.ahca_reported_at ? formatIncidentDetailTimestamp(incident.ahca_reported_at) : incident.ahca_reported ? "Yes" : incident.ahca_reportable ? "Pending" : "Not reportable"} />
        <Row label="Insurance reported" value={incident.insurance_reported_at ? formatIncidentDetailTimestamp(incident.insurance_reported_at) : incident.insurance_reported ? "Yes" : incident.insurance_reportable ? "Pending" : "Not reportable"} />
      </div>

      {acknowledgmentLine ? (
        <p role="status" className="text-sm text-success">
          {acknowledgmentLine}
        </p>
      ) : null}
      {openObligations.length > 0 ? (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Open obligations</p>
          <ul className="mt-2 list-inside list-disc text-sm text-foreground">
            {openObligations.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-success">Every notification and reporting step for this level is on file.</p>
      )}

      <div className="rounded-[8px] border border-border bg-muted/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs font-medium text-muted-foreground">Who was told</p>
          <Link href={`/admin/care-events/${careEvent.id}`} className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
            Open the care event card
          </Link>
        </div>
        <div className="mt-3">
          <CareEventDeliveryLedger rows={careEvent.deliveries} timeZone={careEvent.timeZone} />
        </div>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/50 p-4">
        <p className="text-xs font-medium text-muted-foreground">Reporting actions</p>
        <p className="mt-1 text-xs text-muted-foreground">Family, physician, EMS, and AHCA decisions are recorded on the care event card.</p>
        <div className="mt-3 flex flex-wrap gap-2">{actions}</div>
      </div>
    </div>
  );
}
