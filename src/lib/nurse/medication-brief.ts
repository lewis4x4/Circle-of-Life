/**
 * Nurse (Medication Manager) dashboard brief.
 * Aggregates eMAR compliance, controlled substance counts, med errors, clinical watchlist.
 */

import { createClient } from "@/lib/supabase/client";
import { facilityDatetimeLocalToUtcIso, todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { NURSE_WATCHLIST_NO_ROOM_COPY } from "@/lib/nurse/medication-brief-display-copy";
import { fetchResidentAssuranceCommandBrief } from "@/lib/resident-assurance/command-center-brief";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

/** Counts are `null` when the query failed — never render a failed read as 0. */
export type NurseMedicationBrief = {
  activeMedications: number | null;
  emarCompliancePct: number | null;
  medErrors7d: number | null;
  controlledDiscrepancies: number | null;
  missedDosesToday: number | null;
  prnGiven24h: number | null;
  residentAssurance: {
    activeWatches: number;
    openEscalations: number;
    openIntegrityFlags: number;
    criticalSafetyResidents: number;
  };
  watchlistResidents: Array<{
    id: string;
    name: string;
    room: string;
    reason: string;
  }>;
};

type CountResponse = { count: number | null; error?: unknown };

function countOrNull(res: unknown): number | null {
  const { count, error } = res as CountResponse;
  if (error || count === null || count === undefined) return null;
  return count;
}
type ScopedQuery<T> = { eq(column: string, value: string): T };

type BrowserClient = ReturnType<typeof createClient>;
type FacilityScope = <T extends ScopedQuery<T>>(q: T) => T;

/**
 * Medication errors reported since `sinceIso`, from both intake paths:
 * structured reports in `medication_errors` (the record of truth — the
 * /admin/medications/errors review queue and the admin command center count
 * this table) plus incidents filed with category `medication_error` (the
 * med-tech incident modal and /admin/incidents/new) that no report already
 * links through `medication_errors.linked_incident_id`. `null` when any read
 * fails — a partial count would understate errors.
 */
async function countMedErrorsSince(
  supabase: BrowserClient,
  f: FacilityScope,
  sinceIso: string,
): Promise<number | null> {
  const [reportsRes, linkedRes] = await Promise.all([
    f(supabase.from("medication_errors" as never).select("id", { count: "exact", head: true }))
      .gte("occurred_at", sinceIso)
      .is("deleted_at", null),
    f(supabase.from("medication_errors" as never).select("linked_incident_id"))
      .gte("occurred_at", sinceIso)
      .not("linked_incident_id", "is", null)
      .is("deleted_at", null),
  ]);
  const reports = countOrNull(reportsRes);
  const linked = linkedRes as { data: Array<{ linked_incident_id: string | null }> | null; error?: unknown };
  if (reports === null || linked.error || !linked.data) return null;

  const linkedIncidentIds = [
    ...new Set(linked.data.map((row) => row.linked_incident_id).filter((id): id is string => Boolean(id))),
  ];
  let incidentsQuery = f(supabase.from("incidents" as never).select("id", { count: "exact", head: true }))
    .gte("occurred_at", sinceIso)
    .eq("category", "medication_error")
    .is("deleted_at", null);
  if (linkedIncidentIds.length > 0) {
    incidentsQuery = incidentsQuery.not("id", "in", `(${linkedIncidentIds.join(",")})`);
  }
  const unlinkedIncidents = countOrNull(await incidentsQuery);
  if (unlinkedIncidents === null) return null;
  return reports + unlinkedIncidents;
}

export async function fetchNurseMedicationBrief(
  facilityId: string | null,
): Promise<NurseMedicationBrief> {
  const supabase = createClient();

  const f = <T extends ScopedQuery<T>>(q: T): T =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const todayStart = facilityDatetimeLocalToUtcIso(`${todayFacilityDateIso()}T00:00`);
  const yesterday24h = new Date(Date.now() - 86400000).toISOString();

  const [
    activeMedsRes,
    emarTodayRes,
    emarGivenRes,
    medErrorsRes,
    controlledRes,
    missedRes,
    prnRes,
    residentAssurance,
  ] = await Promise.all([
    f(supabase.from("resident_medications" as never).select("id", { count: "exact", head: true }))
      .eq("status", "active")
      .is("deleted_at", null),
    f(supabase.from("emar_records" as never).select("id", { count: "exact", head: true }))
      .gte("scheduled_time", todayStart)
      .is("deleted_at", null),
    f(supabase.from("emar_records" as never).select("id", { count: "exact", head: true }))
      .gte("scheduled_time", todayStart)
      .in("status", ["given", "self_administered"])
      .is("deleted_at", null),
    countMedErrorsSince(supabase, f, sevenDaysAgo),
    f(supabase.from("controlled_substance_counts" as never).select("id", { count: "exact", head: true }))
      .neq("discrepancy", 0)
      .not("discrepancy_resolved", "is", true)
      .is("deleted_at", null),
    f(supabase.from("emar_records" as never).select("id", { count: "exact", head: true }))
      .gte("scheduled_time", todayStart)
      .in("status", ["held", "not_available"])
      .is("deleted_at", null),
    f(supabase.from("emar_records" as never).select("id", { count: "exact", head: true }))
      .gte("scheduled_time", yesterday24h)
      .eq("status", "given")
      .is("deleted_at", null),
    fetchResidentAssuranceCommandBrief(facilityId),
  ]);

  const activeMedications = countOrNull(activeMedsRes);
  const emarTotal = countOrNull(emarTodayRes);
  const emarGiven = countOrNull(emarGivenRes);
  const emarCompliancePct =
    emarTotal === null || emarGiven === null
      ? null
      : emarTotal > 0
        ? Math.round((emarGiven / emarTotal) * 100)
        : 100;
  const medErrors7d = medErrorsRes;
  // Open discrepancy = discrepancy <> 0 and not resolved (NULL counts as open,
  // matching /admin/medications/controlled).
  const controlledDiscrepancies = countOrNull(controlledRes);
  const missedDosesToday = countOrNull(missedRes);
  const prnGiven24h = countOrNull(prnRes);

  return {
    activeMedications,
    emarCompliancePct,
    medErrors7d,
    controlledDiscrepancies,
    missedDosesToday,
    prnGiven24h,
    residentAssurance: {
      activeWatches: residentAssurance.activeWatches,
      openEscalations: residentAssurance.openEscalations,
      openIntegrityFlags: residentAssurance.openIntegrityFlags,
      criticalSafetyResidents: residentAssurance.criticalSafetyResidents,
    },
    watchlistResidents: residentAssurance.highRiskResidents.map((resident) => ({
      id: resident.id,
      name: resident.name,
      room: NURSE_WATCHLIST_NO_ROOM_COPY,
      reason: `${resident.riskTier} risk · score ${resident.score}`,
    })),
  };
}
