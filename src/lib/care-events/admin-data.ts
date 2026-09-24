/**
 * Supabase reads and writes for the Administrator's care event card
 * (`/admin/care-events/[id]`, spec 07A §5). Typed against `Database`; the
 * pure mappers are exported for tests and never touch IO.
 */

import { formatProfileName } from "@/lib/format/datetime";
import type { SupabaseClient } from "@supabase/supabase-js";

import { formatCaregiverFacilityResidentRoomLabel } from "@/lib/caregiver/facility-residents-display-copy";
import { levelNumberFromSeverity, type IncidentLevelNumber } from "@/lib/incidents/incidents-display-copy";
import type { ObligationDelivery } from "@/lib/incidents/workflow-obligations";
import type { Database, Json } from "@/types/database";

import {
  channelWord,
  deliverySkipReasonLine,
  deliveryStatusWord,
  deliveryTargetWord,
  formatClockTime,
  isCloseGateItem,
  type CloseGateItem,
} from "./admin-copy";
import { emptyCareEventFlags, isCareEventKind, type CareEventFlags } from "./level-engine";
import { careEventTileWord } from "./tiles";
import { enumLabel } from "@/lib/display/enum-label";

type Client = SupabaseClient<Database>;
type CareEventRow = Database["public"]["Tables"]["care_events"]["Row"];
type DeliveryRow = Database["public"]["Tables"]["care_event_deliveries"]["Row"];

export type CareEventAdminStatus = "open" | "acknowledged" | "closed";

const DEFAULT_TIME_ZONE = "America/New_York";
const PHOTO_BUCKET = "incident-photos";
const PHOTO_URL_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Pure mappers
// ---------------------------------------------------------------------------

function asObject(value: Json | null | undefined): Record<string, Json | undefined> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function asString(value: Json | undefined): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function asBoolean(value: Json | undefined): boolean | null {
  return typeof value === "boolean" ? value : null;
}

/** The completion form's stamps under care_events.answers.admin. */
export type CareEventAdminAnswers = {
  familyNotifiedAt: string | null;
  familyLater: boolean;
  physicianNotifiedAt: string | null;
  physicianLater: boolean;
  ems: string | null;
  correctiveActions: string[];
  correctiveOther: string | null;
  ahcaReportable: boolean | null;
  ahcaReason: string | null;
  dcfReportedAt: string | null;
  videoSecured: string | null;
};

export function parseAdminAnswers(answers: Json | null | undefined): CareEventAdminAnswers {
  const admin = asObject(asObject(answers).admin);
  const chips = Array.isArray(admin.corrective_actions)
    ? admin.corrective_actions.filter((entry): entry is string => typeof entry === "string")
    : [];
  return {
    familyNotifiedAt: asString(admin.family_notified_at),
    familyLater: asBoolean(admin.family_later) ?? false,
    physicianNotifiedAt: asString(admin.physician_notified_at),
    physicianLater: asBoolean(admin.physician_later) ?? false,
    ems: asString(admin.ems),
    correctiveActions: chips,
    correctiveOther: asString(admin.corrective_other),
    ahcaReportable: asBoolean(admin.ahca_reportable),
    ahcaReason: asString(admin.ahca_reason),
    dcfReportedAt: asString(admin.dcf_reported_at),
    videoSecured: asString(admin.video_secured),
  };
}

export function parseAttachments(answers: Json | null | undefined): string[] {
  const list = asObject(answers).attachments;
  return Array.isArray(list) ? list.filter((entry): entry is string => typeof entry === "string") : [];
}

export function parseFlags(flags: Json | null | undefined): CareEventFlags {
  const source = asObject(flags);
  const parsed = emptyCareEventFlags();
  for (const key of Object.keys(parsed) as (keyof CareEventFlags)[]) {
    parsed[key] = asBoolean(source[key]) ?? false;
  }
  return parsed;
}

export function parseCareEventStatus(value: string | null | undefined): CareEventAdminStatus {
  return value === "acknowledged" || value === "closed" ? value : "open";
}

export type AdminSectionResult = {
  status: CareEventAdminStatus;
  finalLevel: IncidentLevelNumber;
  missing: CloseGateItem[];
};

/** `{ status, final_level, missing }` from complete_care_event_admin_section. */
export function parseAdminSectionResult(value: unknown): AdminSectionResult {
  const source = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const missing = Array.isArray(source.missing) ? source.missing.filter(isCloseGateItem) : [];
  return {
    status: parseCareEventStatus(typeof source.status === "string" ? source.status : null),
    finalLevel: levelNumberFromSeverity(
      typeof source.final_level === "number" || typeof source.final_level === "string" ? source.final_level : null,
    ) ?? 1,
    missing,
  };
}

export type CareEventDeliveryLine = {
  id: string;
  targetUserId: string | null;
  targetName: string | null;
  targetRole: string | null;
  channel: string;
  status: string;
  step: number;
  createdAt: string;
  sendAfter: string;
  sentAt: string | null;
  acknowledgedAt: string | null;
  skipReason: string | null;
};

export function toDeliveryLine(row: DeliveryRow, nameById: ReadonlyMap<string, string | null>): CareEventDeliveryLine {
  return {
    id: row.id,
    targetUserId: row.target_user_id,
    targetName: row.target_user_id ? (nameById.get(row.target_user_id) ?? null) : null,
    targetRole: row.target_role,
    channel: row.channel,
    status: row.status,
    step: row.escalation_step,
    createdAt: row.created_at,
    sendAfter: row.send_after,
    sentAt: row.sent_at,
    acknowledgedAt: row.acknowledged_at,
    skipReason: row.skip_reason,
  };
}

/** The ledger row in the shape `buildIncidentOpenObligations` reads. */
export function toObligationDelivery(line: CareEventDeliveryLine): ObligationDelivery {
  return {
    target_user_id: line.targetUserId,
    channel: line.channel,
    status: line.status,
    escalation_step: line.step,
    send_after: line.sendAfter,
    sent_at: line.sentAt,
    acknowledged_at: line.acknowledgedAt,
  };
}

export type DeliveryLedgerWords = {
  target: string;
  channel: string;
  status: string;
  /** Sent or acknowledged clock time; null when nothing has gone out yet. */
  time: string | null;
  /** Skip reason in plain words, or null. */
  note: string | null;
};

/** One ledger row in operator words. */
export function deliveryLedgerWords(line: CareEventDeliveryLine, timeZone: string): DeliveryLedgerWords {
  const acknowledgedAt = formatClockTime(line.acknowledgedAt, timeZone);
  const sentAt = formatClockTime(line.sentAt, timeZone);
  return {
    target: deliveryTargetWord(line.targetName, line.targetRole),
    channel: channelWord(line.channel),
    status: deliveryStatusWord(line.status),
    time: line.status === "acknowledged" ? (acknowledgedAt ?? sentAt) : sentAt,
    note: line.status === "skipped" ? deliverySkipReasonLine(line.skipReason, line.channel) : null,
  };
}

// ---------------------------------------------------------------------------
// The card
// ---------------------------------------------------------------------------

export type CareEventIncidentLite = {
  id: string;
  incidentNumber: string;
  status: string;
  familyNotified: boolean;
  familyNotifiedAt: string | null;
  familyNotifiedMethod: string | null;
  physicianNotified: boolean;
  physicianNotifiedAt: string | null;
  physicianOrders: string | null;
  injuryTreatment: string | null;
  ahcaReportable: boolean;
  resolutionNotes: string | null;
};

export type CareEventAdminCard = {
  id: string;
  status: CareEventAdminStatus;
  kind: string;
  tileWord: string;
  level: IncidentLevelNumber;
  derivedLevel: IncidentLevelNumber;
  levelChangeReason: string | null;
  sentence: string;
  note: string | null;
  occurredAt: string;
  createdAt: string;
  acknowledgedAt: string | null;
  acknowledgedByName: string | null;
  closedAt: string | null;
  facilityId: string;
  organizationId: string;
  timeZone: string;
  resident: { id: string; name: string; roomLabel: string } | null;
  reporter: { id: string; fullName: string | null; firstName: string | null; phone: string | null };
  incident: CareEventIncidentLite | null;
  flags: CareEventFlags;
  admin: CareEventAdminAnswers;
  attachments: string[];
  deliveries: CareEventDeliveryLine[];
  /** Null when the signed-in role may view but not complete the form. */
  gate: AdminSectionResult | null;
};

function firstNameOf(fullName: string | null): string | null {
  const first = fullName?.trim().split(/\s+/)[0];
  return first || null;
}

async function fetchNames(supabase: Client, ids: Iterable<string>): Promise<Map<string, string | null>> {
  const unique = [...new Set(ids)];
  const nameById = new Map<string, string | null>();
  if (unique.length === 0) return nameById;
  const profiles = await supabase.from("user_profiles").select("id, full_name").in("id", unique);
  if (profiles.error) throw profiles.error;
  for (const profile of profiles.data ?? []) nameById.set(profile.id, profile.full_name);
  return nameById;
}

export async function fetchCareEventDeliveries(supabase: Client, careEventId: string): Promise<CareEventDeliveryLine[]> {
  const result = await supabase
    .from("care_event_deliveries")
    .select("*")
    .eq("care_event_id", careEventId)
    .order("escalation_step", { ascending: true })
    .order("created_at", { ascending: true });
  if (result.error) throw result.error;
  const rows = result.data ?? [];
  const nameById = await fetchNames(
    supabase,
    rows.map((row) => row.target_user_id).filter((id): id is string => Boolean(id)),
  );
  return rows.map((row) => toDeliveryLine(row, nameById));
}

/**
 * The close gate without writing anything at all: `care_event_close_gate` is
 * STABLE and returns `{ status, final_level, missing }`. Returns null when the
 * role may not complete the form.
 */
export async function fetchCloseGate(supabase: Client, careEventId: string): Promise<AdminSectionResult | null> {
  // Read-only (STABLE) twin of the admin section function: a card load must
  // never write a phantom audit row.
  const result = await supabase.rpc("care_event_close_gate", { p_care_event_id: careEventId });
  if (result.error) {
    if (/forbidden/i.test(result.error.message)) return null;
    throw result.error;
  }
  return parseAdminSectionResult(result.data);
}

async function fetchResidentWithRoom(
  supabase: Client,
  residentId: string,
): Promise<CareEventAdminCard["resident"]> {
  const resident = await supabase
    .from("residents")
    .select("id, first_name, last_name, bed_id")
    .eq("id", residentId)
    .maybeSingle();
  if (resident.error) throw resident.error;
  if (!resident.data) return null;
  let roomNumber: string | null = null;
  let bedLabel: string | null = null;
  if (resident.data.bed_id) {
    const bed = await supabase.from("beds").select("id, room_id, bed_label").eq("id", resident.data.bed_id).maybeSingle();
    if (bed.error) throw bed.error;
    bedLabel = bed.data?.bed_label ?? null;
    if (bed.data?.room_id) {
      const room = await supabase.from("rooms").select("id, room_number").eq("id", bed.data.room_id).maybeSingle();
      if (room.error) throw room.error;
      roomNumber = room.data?.room_number ?? null;
    }
  }
  const name = `${resident.data.first_name ?? ""} ${resident.data.last_name ?? ""}`.trim() || "No name posted";
  return { id: resident.data.id, name, roomLabel: formatCaregiverFacilityResidentRoomLabel(roomNumber, bedLabel) };
}

async function fetchIncidentLite(supabase: Client, incidentId: string): Promise<CareEventIncidentLite | null> {
  const result = await supabase
    .from("incidents")
    .select(
      "id, incident_number, status, family_notified, family_notified_at, family_notified_method, physician_notified, physician_notified_at, physician_orders_received, injury_treatment, ahca_reportable, resolution_notes",
    )
    .eq("id", incidentId)
    .maybeSingle();
  if (result.error) throw result.error;
  const row = result.data;
  if (!row) return null;
  return {
    id: row.id,
    incidentNumber: row.incident_number,
    status: row.status,
    familyNotified: row.family_notified,
    familyNotifiedAt: row.family_notified_at,
    familyNotifiedMethod: row.family_notified_method,
    physicianNotified: row.physician_notified,
    physicianNotifiedAt: row.physician_notified_at,
    physicianOrders: row.physician_orders_received,
    injuryTreatment: row.injury_treatment,
    ahcaReportable: row.ahca_reportable,
    resolutionNotes: row.resolution_notes,
  };
}

function toCard(
  row: CareEventRow,
  parts: {
    timeZone: string;
    resident: CareEventAdminCard["resident"];
    reporter: CareEventAdminCard["reporter"];
    incident: CareEventIncidentLite | null;
    acknowledgedByName: string | null;
    deliveries: CareEventDeliveryLine[];
    gate: AdminSectionResult | null;
  },
): CareEventAdminCard {
  const kind = row.kind;
  return {
    id: row.id,
    status: parseCareEventStatus(row.status),
    kind,
    tileWord: isCareEventKind(kind) ? careEventTileWord(kind) : enumLabel(kind),
    level: levelNumberFromSeverity(row.final_level) ?? 1,
    derivedLevel: levelNumberFromSeverity(row.derived_level) ?? 1,
    levelChangeReason: row.level_change_reason,
    sentence: row.sentence,
    note: row.note,
    occurredAt: row.occurred_at,
    createdAt: row.created_at,
    acknowledgedAt: row.acknowledged_at,
    acknowledgedByName: parts.acknowledgedByName,
    closedAt: row.closed_at,
    facilityId: row.facility_id,
    organizationId: row.organization_id,
    timeZone: parts.timeZone,
    resident: parts.resident,
    reporter: parts.reporter,
    incident: parts.incident,
    flags: parseFlags(row.flags),
    admin: parseAdminAnswers(row.answers),
    attachments: parseAttachments(row.answers),
    deliveries: parts.deliveries,
    gate: parts.gate,
  };
}

/**
 * Everything the card renders. Pass `knownGate` right after a stamp so the
 * reload reuses the gate the stamp returned instead of asking again.
 */
export async function loadCareEventCard(
  supabase: Client,
  careEventId: string,
  knownGate?: AdminSectionResult | null,
): Promise<CareEventAdminCard | null> {
  const event = await supabase.from("care_events").select("*").eq("id", careEventId).is("deleted_at", null).maybeSingle();
  if (event.error) throw event.error;
  const row = event.data;
  if (!row) return null;

  const [facility, reporter, resident, incident, deliveries, gate, acknowledgedByName] = await Promise.all([
    supabase.from("facilities").select("id, timezone").eq("id", row.facility_id).maybeSingle(),
    supabase.from("user_profiles").select("id, full_name, phone").eq("id", row.reported_by).maybeSingle(),
    row.resident_id ? fetchResidentWithRoom(supabase, row.resident_id) : Promise.resolve(null),
    row.incident_id ? fetchIncidentLite(supabase, row.incident_id) : Promise.resolve(null),
    fetchCareEventDeliveries(supabase, careEventId),
    knownGate === undefined ? fetchCloseGate(supabase, careEventId) : Promise.resolve(knownGate),
    row.acknowledged_by
      ? fetchNames(supabase, [row.acknowledged_by]).then((names) => names.get(row.acknowledged_by ?? "") ?? null)
      : Promise.resolve(null),
  ]);
  if (facility.error) throw facility.error;
  if (reporter.error) throw reporter.error;

  return toCard(row, {
    timeZone: facility.data?.timezone || DEFAULT_TIME_ZONE,
    resident,
    reporter: {
      id: row.reported_by,
      fullName: formatProfileName(reporter.data?.full_name, { fallback: "" }) || null,
      firstName: firstNameOf(formatProfileName(reporter.data?.full_name, { fallback: "" }) || null),
      phone: reporter.data?.phone?.trim() || null,
    },
    incident,
    acknowledgedByName,
    deliveries,
    gate,
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/** One section of the completion form; the function only reads the keys present. */
export type AdminSection = {
  family_notified?: { now: boolean; method?: string };
  physician_notified?: { now: boolean; orders?: string };
  ems?: { treatment: "er_visit" | "hospitalization" | "none" };
  corrective_actions?: { chips: string[]; other?: string };
  ahca?: { reportable: boolean; reason_code?: string };
  dcf_reported_at?: string;
  video_secured?: "yes" | "no" | "na";
  lower_level?: { level: number; reason: string };
  close?: boolean;
};

export async function completeAdminSection(
  supabase: Client,
  careEventId: string,
  section: AdminSection,
): Promise<AdminSectionResult> {
  const result = await supabase.rpc("complete_care_event_admin_section", {
    p_care_event_id: careEventId,
    p_section: section as Json,
  });
  if (result.error) throw result.error;
  return parseAdminSectionResult(result.data);
}

export async function acknowledgeCareEvent(supabase: Client, careEventId: string): Promise<void> {
  const result = await supabase.rpc("acknowledge_care_event", { p_care_event_id: careEventId });
  if (result.error) throw result.error;
}

export type SignedPhoto = { path: string; url: string | null };

/** Short-lived signed URLs for the private incident-photos bucket; failures become `url: null`. */
export async function signCareEventPhotos(supabase: Client, paths: readonly string[]): Promise<SignedPhoto[]> {
  return Promise.all(
    paths.map(async (path) => {
      try {
        const signed = await supabase.storage.from(PHOTO_BUCKET).createSignedUrl(path, PHOTO_URL_TTL_SECONDS);
        return { path, url: signed.error ? null : (signed.data?.signedUrl ?? null) };
      } catch {
        return { path, url: null };
      }
    }),
  );
}

/** A plain error line for a failed stamp; the SQL messages start with "care_event:". */
export function describeAdminSectionError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/close gate/i.test(message)) return "The close gate is not met yet.";
  if (/lower than the current level/i.test(message)) return "Pick a level below the current one.";
  if (/reason is required/i.test(message)) return "Pick a reason before lowering the level.";
  if (/forbidden/i.test(message)) return "Completion is for the Administrator or Assistant.";
  return "That did not save. Try again.";
}
