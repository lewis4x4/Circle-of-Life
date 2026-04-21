/**
 * Nurse (Medication Manager) dashboard brief.
 * Aggregates eMAR compliance, controlled substance counts, med errors, clinical watchlist.
 */

import { createClient } from "@/lib/supabase/client";
import { fetchResidentAssuranceCommandBrief } from "@/lib/resident-assurance/command-center-brief";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

export type NurseMedicationBrief = {
  activeMedications: number;
  emarCompliancePct: number;
  medErrors7d: number;
  controlledDiscrepancies: number;
  missedDosesToday: number;
  prnGiven24h: number;
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

export async function fetchNurseMedicationBrief(
  facilityId: string | null,
): Promise<NurseMedicationBrief> {
  const supabase = createClient();

  const f = (q: any) =>
    isValidFacilityIdForQuery(facilityId) ? q.eq("facility_id", facilityId) : q;

  const sevenDaysAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const todayStart = new Date().toISOString().split("T")[0] + "T00:00:00";
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
    f(supabase.from("incidents" as never).select("id", { count: "exact", head: true }))
      .gte("occurred_at", sevenDaysAgo)
      .eq("category", "medication_error")
      .is("deleted_at", null),
    f(supabase.from("controlled_substance_counts" as never).select("id", { count: "exact", head: true }))
      .eq("has_discrepancy", true)
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

  const activeMedications = (activeMedsRes as any).count ?? 0;
  const emarTotal = (emarTodayRes as any).count ?? 0;
  const emarGiven = (emarGivenRes as any).count ?? 0;
  const emarCompliancePct = emarTotal > 0 ? Math.round((emarGiven / emarTotal) * 100) : 100;
  const medErrors7d = (medErrorsRes as any).count ?? 0;
  const controlledDiscrepancies = (controlledRes as any).count ?? 0;
  const missedDosesToday = (missedRes as any).count ?? 0;
  const prnGiven24h = (prnRes as any).count ?? 0;

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
      room: "—",
      reason: `${resident.riskTier} risk · score ${resident.score}`,
    })),
  };
}
