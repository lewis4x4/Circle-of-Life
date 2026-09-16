/**
 * Open obligations for an incident, in plain words (spec 07A §6.3).
 *
 * With a care event the acknowledgment is a query over the delivery ledger,
 * never a checkbox: "Administrator acknowledged 10:07 PM (push, 2 min)" or
 * "Administrator not yet acknowledged (escalated to on-call 10:16 PM)".
 * Pre-launch incidents without a care event keep the manual flags, with
 * "Notify the Administrator or Assistant." as the first line. COL's audience
 * is the Administrator or Assistant; no line names a nurse.
 */

import { formatClockTime, minutesBetween, channelWord } from "@/lib/care-events/admin-copy";
import { levelNumberFromSeverity } from "@/lib/incidents/incidents-display-copy";

export type IncidentWorkflowObligationShape = {
  severity: string;
  nurse_notified?: boolean;
  administrator_notified: boolean;
  owner_notified: boolean;
  physician_notified: boolean;
  family_notified: boolean;
  ahca_reportable: boolean;
  ahca_reported: boolean;
  insurance_reportable: boolean;
  insurance_reported: boolean;
};

/** An active notification_routes row for the facility. */
export type ObligationRoute = {
  name: string;
  severity_min: string;
};

/** A care_event_deliveries row, as much of it as the obligation lines read. */
export type ObligationDelivery = {
  target_user_id: string | null;
  channel: string;
  status: string;
  escalation_step: number;
  send_after?: string | null;
  sent_at: string | null;
  acknowledged_at?: string | null;
};

/** The care event behind the incident, when the three-tap flow created it. */
export type ObligationCareEvent = {
  id: string;
  status: string;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  final_level: string;
  /** answers.admin stamps that satisfy a decision without a notification (family_later, physician_later, ahca_reportable). */
  admin?: {
    familyLater?: boolean;
    physicianLater?: boolean;
    ahcaReportable?: boolean | null;
  } | null;
};

export type IncidentObligationInput = {
  incident: IncidentWorkflowObligationShape;
  routes: readonly ObligationRoute[];
  deliveries: readonly ObligationDelivery[];
  careEvent: ObligationCareEvent | null;
  /** Facility timezone for clock times; defaults to America/New_York. */
  timeZone?: string;
};

const DEFAULT_TIME_ZONE = "America/New_York";
const SENT_STATUSES = new Set(["sent", "delivered", "acknowledged"]);

function isLevel3Or4(severity: string): boolean {
  const level = levelNumberFromSeverity(severity);
  return level === 3 || level === 4;
}

function firstSentDeliveryFor(userId: string | null, deliveries: readonly ObligationDelivery[]): ObligationDelivery | null {
  if (!userId) return null;
  const mine = deliveries
    .filter((row) => row.target_user_id === userId && row.sent_at && SENT_STATUSES.has(row.status))
    .sort((a, b) => new Date(a.sent_at ?? 0).getTime() - new Date(b.sent_at ?? 0).getTime());
  return mine[0] ?? null;
}

function earliestEscalation(deliveries: readonly ObligationDelivery[]): { sentAt: string | null; sendAfter: string | null } | null {
  const later = deliveries.filter((row) => row.escalation_step >= 1 && row.status !== "skipped");
  if (later.length === 0) return null;
  const sent = later
    .filter((row) => row.sent_at)
    .sort((a, b) => new Date(a.sent_at ?? 0).getTime() - new Date(b.sent_at ?? 0).getTime())[0];
  if (sent?.sent_at) return { sentAt: sent.sent_at, sendAfter: null };
  const queued = later
    .filter((row) => row.send_after)
    .sort((a, b) => new Date(a.send_after ?? 0).getTime() - new Date(b.send_after ?? 0).getTime())[0];
  return { sentAt: null, sendAfter: queued?.send_after ?? null };
}

/**
 * "Administrator acknowledged 10:07 PM (push, 2 min)" once the care event is
 * acknowledged; null while it is open or when there is no care event.
 */
export function buildIncidentAcknowledgmentLine(input: IncidentObligationInput): string | null {
  const { careEvent, deliveries } = input;
  if (!careEvent?.acknowledged_at) return null;
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const time = formatClockTime(careEvent.acknowledged_at, timeZone);
  const minutes = minutesBetween(careEvent.created_at, careEvent.acknowledged_at);
  const via = firstSentDeliveryFor(careEvent.acknowledged_by, deliveries);
  const detail = via ? `${channelWord(via.channel).toLowerCase()}, ${minutes} min` : `${minutes} min`;
  return time ? `Administrator acknowledged ${time} (${detail})` : `Administrator acknowledged (${detail})`;
}

function careEventAcknowledgmentObligation(input: IncidentObligationInput): string | null {
  const { careEvent, deliveries, routes } = input;
  if (!careEvent || careEvent.acknowledged_at) return null;
  const timeZone = input.timeZone ?? DEFAULT_TIME_ZONE;
  const level = levelNumberFromSeverity(careEvent.final_level) ?? 1;
  if (level < 2) return null;
  const escalation = earliestEscalation(deliveries);
  if (escalation?.sentAt) {
    const time = formatClockTime(escalation.sentAt, timeZone);
    return time ? `Administrator not yet acknowledged (escalated to on-call ${time})` : "Administrator not yet acknowledged (escalated to on-call)";
  }
  if (escalation?.sendAfter) {
    const time = formatClockTime(escalation.sendAfter, timeZone);
    return time ? `Administrator not yet acknowledged (on-call alert queued for ${time})` : "Administrator not yet acknowledged";
  }
  const routed = routes.some((route) => (levelNumberFromSeverity(route.severity_min) ?? 5) <= level);
  if (deliveries.length === 0 && routes.length > 0 && !routed) {
    return "Administrator not yet acknowledged (no alert route covers this level; tell the Administrator or Assistant in person)";
  }
  return "Administrator not yet acknowledged";
}

/** Open obligations only. Resolved acknowledgments come from `buildIncidentAcknowledgmentLine`. */
export function buildIncidentOpenObligations(input: IncidentObligationInput): string[] {
  const { incident, careEvent } = input;
  const items: string[] = [];
  const severe = isLevel3Or4(careEvent?.final_level ?? incident.severity);

  if (careEvent) {
    const acknowledgment = careEventAcknowledgmentObligation(input);
    if (acknowledgment) items.push(acknowledgment);
    if (severe) {
      if (!incident.physician_notified && !careEvent.admin?.physicianLater) items.push("Physician decision pending");
      if (!incident.family_notified && !careEvent.admin?.familyLater) items.push("Family decision pending");
      if (careEvent.admin?.ahcaReportable == null && !incident.ahca_reportable) items.push("AHCA decision pending");
    }
    if (incident.ahca_reportable && !incident.ahca_reported) items.push("AHCA report pending");
    if (incident.insurance_reportable && !incident.insurance_reported) items.push("Report to the insurance carrier");
    return items;
  }

  if (!incident.administrator_notified) items.push("Notify the Administrator or Assistant.");
  if (severe) {
    if (!incident.owner_notified) items.push("Notify the owner.");
    if (!incident.physician_notified) items.push("Notify the physician.");
    if (!incident.family_notified) items.push("Notify the family.");
  }
  if (incident.ahca_reportable && !incident.ahca_reported) items.push("Complete AHCA reporting.");
  if (incident.insurance_reportable && !incident.insurance_reported) items.push("Report to the insurance carrier.");
  return items;
}
