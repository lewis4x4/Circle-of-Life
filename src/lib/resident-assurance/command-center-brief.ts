import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";

export type ResidentAssuranceRiskResident = {
  id: string;
  name: string;
  riskTier: "low" | "moderate" | "high" | "critical";
  score: number;
};

export type ResidentAssuranceCommandBrief = {
  activeWatches: number;
  pendingWatchApprovals: number;
  openEscalations: number;
  openIntegrityFlags: number;
  criticalSafetyResidents: number;
  highOrCriticalSafetyResidents: number;
  highRiskResidents: ResidentAssuranceRiskResident[];
};

export type ResidentAssuranceFacilityRollup = {
  facilityId: string;
  facilityName: string;
  activeWatches: number;
  pendingWatchApprovals: number;
  openEscalations: number;
  openIntegrityFlags: number;
  criticalSafetyResidents: number;
  highOrCriticalSafetyResidents: number;
  heatScore: number;
  heatBand: "stable" | "watch" | "elevated" | "critical";
};

export type ResidentAssuranceFacilityTrendPoint = {
  date: string;
  watchStarts: number;
  escalations: number;
  integrityFlags: number;
  criticalResidents: number;
  heatScore: number;
  heatBand: ResidentAssuranceFacilityRollup["heatBand"];
};

export type ResidentAssuranceFacilityTrendRow = {
  facilityId: string;
  facilityName: string;
  latestHeatScore: number;
  peakHeatScore: number;
  avgHeatScore: number;
  points: ResidentAssuranceFacilityTrendPoint[];
};

type RiskScoreRow = {
  resident_id: string;
  score: number;
  risk_tier: "low" | "moderate" | "high" | "critical";
  computed_at: string;
  residents?: { first_name: string; last_name: string; preferred_name: string | null } | null;
};

function residentName(
  resident: { first_name: string; last_name: string; preferred_name: string | null } | null | undefined,
  fallback: string,
) {
  if (!resident) return fallback;
  return resident.preferred_name?.trim() || `${resident.first_name} ${resident.last_name}`;
}

function computeHeatBand(score: number): ResidentAssuranceFacilityRollup["heatBand"] {
  if (score >= 12) return "critical";
  if (score >= 7) return "elevated";
  if (score >= 3) return "watch";
  return "stable";
}

function ymdUtc(date: string | Date) {
  return new Date(date).toISOString().slice(0, 10);
}

function buildTrailingDates(days: number) {
  const today = new Date();
  const out: string[] = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const d = new Date(today);
    d.setUTCDate(today.getUTCDate() - offset);
    out.push(ymdUtc(d));
  }
  return out;
}

function computeHeatScore(parts: {
  watchStarts: number;
  escalations: number;
  integrityFlags: number;
  criticalResidents: number;
  highResidents?: number;
}) {
  return (
    parts.watchStarts +
    parts.escalations * 3 +
    parts.integrityFlags * 2 +
    parts.criticalResidents * 4 +
    (parts.highResidents ?? 0)
  );
}

export async function fetchResidentAssuranceCommandBrief(
  facilityId: string | null,
  supabase: SupabaseClient<Database> = createClient(),
): Promise<ResidentAssuranceCommandBrief> {

  const scoped = <T extends { eq(column: string, value: string): T }>(query: T): T =>
    isValidFacilityIdForQuery(facilityId) ? query.eq("facility_id", facilityId) : query;

  const [
    activeWatchesRes,
    pendingWatchApprovalsRes,
    openEscalationsRes,
    openIntegrityFlagsRes,
    riskScoresRes,
  ] = await Promise.all([
    scoped(
      supabase
        .from("resident_watch_instances" as never)
        .select("id", { count: "exact", head: true })
        .eq("status", "active")
        .is("deleted_at", null),
    ),
    scoped(
      supabase
        .from("resident_watch_instances" as never)
        .select("id", { count: "exact", head: true })
        .eq("status", "pending_approval")
        .is("deleted_at", null),
    ),
    scoped(
      supabase
        .from("resident_observation_escalations" as never)
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "in_progress"])
        .is("deleted_at", null),
    ),
    scoped(
      supabase
        .from("resident_observation_integrity_flags" as never)
        .select("id", { count: "exact", head: true })
        .in("status", ["open", "in_progress"])
        .is("deleted_at", null),
    ),
    scoped(
      supabase
        .from("resident_safety_scores" as never)
        .select("resident_id, score, risk_tier, computed_at, residents(first_name, last_name, preferred_name)")
        .is("deleted_at", null)
        .order("computed_at", { ascending: false })
        .limit(200),
    ) as unknown as Promise<{ data: RiskScoreRow[] | null; error: { message: string } | null }>,
  ]);

  const firstError = [
    activeWatchesRes.error,
    pendingWatchApprovalsRes.error,
    openEscalationsRes.error,
    openIntegrityFlagsRes.error,
    riskScoresRes.error,
  ].find(Boolean);
  if (firstError) {
    throw new Error(firstError.message);
  }

  const latestByResident = new Map<string, RiskScoreRow>();
  for (const row of riskScoresRes.data ?? []) {
    if (!latestByResident.has(row.resident_id)) {
      latestByResident.set(row.resident_id, row);
    }
  }

  const latestScores = Array.from(latestByResident.values());
  const criticalSafetyResidents = latestScores.filter((row) => row.risk_tier === "critical").length;
  const highOrCriticalSafetyResidents = latestScores.filter((row) => row.risk_tier === "critical" || row.risk_tier === "high").length;
  const highRiskResidents = latestScores
    .filter((row) => row.risk_tier === "critical" || row.risk_tier === "high")
    .sort((a, b) => a.score - b.score)
    .slice(0, 4)
    .map((row) => ({
      id: row.resident_id,
      name: residentName(row.residents, row.resident_id.slice(0, 8)),
      riskTier: row.risk_tier,
      score: row.score,
    }));

  return {
    activeWatches: activeWatchesRes.count ?? 0,
    pendingWatchApprovals: pendingWatchApprovalsRes.count ?? 0,
    openEscalations: openEscalationsRes.count ?? 0,
    openIntegrityFlags: openIntegrityFlagsRes.count ?? 0,
    criticalSafetyResidents,
    highOrCriticalSafetyResidents,
    highRiskResidents,
  };
}

export async function fetchResidentAssuranceFacilityHeatMap(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ResidentAssuranceFacilityRollup[]> {
  const [facilitiesRes, watchesRes, escalationsRes, integrityRes] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    supabase
      .from("resident_watch_instances")
      .select("facility_id, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("status", ["active", "pending_approval"]),
    supabase
      .from("resident_observation_escalations")
      .select("facility_id, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("status", ["open", "in_progress"]),
    supabase
      .from("resident_observation_integrity_flags")
      .select("facility_id, status")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .in("status", ["open", "in_progress"]),
  ]);

  const scoresRes = await (supabase
    .from("resident_safety_scores" as never)
    .select("facility_id, resident_id, risk_tier, computed_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("computed_at", { ascending: false })
    .limit(5000) as unknown as Promise<{
    data: Array<{
      facility_id: string;
      resident_id: string;
      risk_tier: "low" | "moderate" | "high" | "critical";
      computed_at: string;
    }> | null;
    error: { message: string } | null;
  }>);

  const firstError = [
    facilitiesRes.error,
    watchesRes.error,
    escalationsRes.error,
    integrityRes.error,
    scoresRes.error,
  ].find(Boolean);
  if (firstError) {
    throw new Error(firstError.message);
  }

  const activeWatchesByFacility = new Map<string, number>();
  const pendingWatchesByFacility = new Map<string, number>();
  for (const row of watchesRes.data ?? []) {
    if (row.status === "active") {
      activeWatchesByFacility.set(row.facility_id, (activeWatchesByFacility.get(row.facility_id) ?? 0) + 1);
    }
    if (row.status === "pending_approval") {
      pendingWatchesByFacility.set(row.facility_id, (pendingWatchesByFacility.get(row.facility_id) ?? 0) + 1);
    }
  }

  const escalationsByFacility = new Map<string, number>();
  for (const row of escalationsRes.data ?? []) {
    escalationsByFacility.set(row.facility_id, (escalationsByFacility.get(row.facility_id) ?? 0) + 1);
  }

  const integrityByFacility = new Map<string, number>();
  for (const row of integrityRes.data ?? []) {
    integrityByFacility.set(row.facility_id, (integrityByFacility.get(row.facility_id) ?? 0) + 1);
  }

  const latestScoreByResident = new Map<string, { facility_id: string; risk_tier: "low" | "moderate" | "high" | "critical" }>();
  for (const row of scoresRes.data ?? []) {
    if (!latestScoreByResident.has(row.resident_id)) {
      latestScoreByResident.set(row.resident_id, {
        facility_id: row.facility_id,
        risk_tier: row.risk_tier,
      });
    }
  }

  const criticalByFacility = new Map<string, number>();
  const highOrCriticalByFacility = new Map<string, number>();
  for (const row of latestScoreByResident.values()) {
    if (row.risk_tier === "critical") {
      criticalByFacility.set(row.facility_id, (criticalByFacility.get(row.facility_id) ?? 0) + 1);
    }
    if (row.risk_tier === "critical" || row.risk_tier === "high") {
      highOrCriticalByFacility.set(row.facility_id, (highOrCriticalByFacility.get(row.facility_id) ?? 0) + 1);
    }
  }

  return (facilitiesRes.data ?? []).map((facility) => {
    const activeWatches = activeWatchesByFacility.get(facility.id) ?? 0;
    const pendingWatchApprovals = pendingWatchesByFacility.get(facility.id) ?? 0;
    const openEscalations = escalationsByFacility.get(facility.id) ?? 0;
    const openIntegrityFlags = integrityByFacility.get(facility.id) ?? 0;
    const criticalSafetyResidents = criticalByFacility.get(facility.id) ?? 0;
    const highOrCriticalSafetyResidents = highOrCriticalByFacility.get(facility.id) ?? 0;
    const heatScore =
      pendingWatchApprovals * 2 +
      openEscalations * 3 +
      openIntegrityFlags * 2 +
      criticalSafetyResidents * 4 +
      Math.max(0, highOrCriticalSafetyResidents - criticalSafetyResidents);

    return {
      facilityId: facility.id,
      facilityName: facility.name,
      activeWatches,
      pendingWatchApprovals,
      openEscalations,
      openIntegrityFlags,
      criticalSafetyResidents,
      highOrCriticalSafetyResidents,
      heatScore,
      heatBand: computeHeatBand(heatScore),
    };
  });
}

export async function fetchResidentAssuranceFacilityTrendSeries(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  days = 7,
): Promise<ResidentAssuranceFacilityTrendRow[]> {
  const dates = buildTrailingDates(days);
  const startDate = `${dates[0]}T00:00:00.000Z`;

  const [facilitiesRes] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
  ]);

  const watchStartsRes = await (supabase
    .from("resident_watch_instances" as never)
    .select("facility_id, starts_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("starts_at", startDate) as unknown as Promise<{
    data: Array<{ facility_id: string; starts_at: string }> | null;
    error: { message: string } | null;
  }>);

  const escalationsRes = await (supabase
    .from("resident_observation_escalations" as never)
    .select("facility_id, triggered_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("triggered_at", startDate) as unknown as Promise<{
    data: Array<{ facility_id: string; triggered_at: string }> | null;
    error: { message: string } | null;
  }>);

  const integrityRes = await (supabase
    .from("resident_observation_integrity_flags" as never)
    .select("facility_id, detected_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("detected_at", startDate) as unknown as Promise<{
    data: Array<{ facility_id: string; detected_at: string }> | null;
    error: { message: string } | null;
  }>);

  const safetyScoresRes = await (supabase
    .from("resident_safety_scores" as never)
    .select("facility_id, resident_id, risk_tier, computed_at")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .gte("computed_at", startDate)
    .order("computed_at", { ascending: false }) as unknown as Promise<{
    data: Array<{
      facility_id: string;
      resident_id: string;
      risk_tier: "low" | "moderate" | "high" | "critical";
      computed_at: string;
    }> | null;
    error: { message: string } | null;
  }>);

  const firstError = [
    facilitiesRes.error,
    watchStartsRes.error,
    escalationsRes.error,
    integrityRes.error,
    safetyScoresRes.error,
  ].find(Boolean);
  if (firstError) {
    throw new Error(firstError.message);
  }

  const watchStartsByKey = new Map<string, number>();
  for (const row of watchStartsRes.data ?? []) {
    const key = `${row.facility_id}:${ymdUtc(row.starts_at)}`;
    watchStartsByKey.set(key, (watchStartsByKey.get(key) ?? 0) + 1);
  }

  const escalationsByKey = new Map<string, number>();
  for (const row of escalationsRes.data ?? []) {
    const key = `${row.facility_id}:${ymdUtc(row.triggered_at)}`;
    escalationsByKey.set(key, (escalationsByKey.get(key) ?? 0) + 1);
  }

  const integrityByKey = new Map<string, number>();
  for (const row of integrityRes.data ?? []) {
    const key = `${row.facility_id}:${ymdUtc(row.detected_at)}`;
    integrityByKey.set(key, (integrityByKey.get(key) ?? 0) + 1);
  }

  const latestScoreByResidentDay = new Map<string, { facility_id: string; risk_tier: "low" | "moderate" | "high" | "critical"; date: string }>();
  for (const row of safetyScoresRes.data ?? []) {
    const date = ymdUtc(row.computed_at);
    const key = `${row.resident_id}:${date}`;
    if (!latestScoreByResidentDay.has(key)) {
      latestScoreByResidentDay.set(key, {
        facility_id: row.facility_id,
        risk_tier: row.risk_tier,
        date,
      });
    }
  }

  const criticalByKey = new Map<string, number>();
  const highByKey = new Map<string, number>();
  for (const row of latestScoreByResidentDay.values()) {
    const key = `${row.facility_id}:${row.date}`;
    if (row.risk_tier === "critical") {
      criticalByKey.set(key, (criticalByKey.get(key) ?? 0) + 1);
    } else if (row.risk_tier === "high") {
      highByKey.set(key, (highByKey.get(key) ?? 0) + 1);
    }
  }

  return (facilitiesRes.data ?? []).map((facility) => {
    const points = dates.map((date) => {
      const key = `${facility.id}:${date}`;
      const watchStarts = watchStartsByKey.get(key) ?? 0;
      const escalations = escalationsByKey.get(key) ?? 0;
      const integrityFlags = integrityByKey.get(key) ?? 0;
      const criticalResidents = criticalByKey.get(key) ?? 0;
      const highResidents = highByKey.get(key) ?? 0;
      const heatScore = computeHeatScore({
        watchStarts,
        escalations,
        integrityFlags,
        criticalResidents,
        highResidents,
      });

      return {
        date,
        watchStarts,
        escalations,
        integrityFlags,
        criticalResidents,
        heatScore,
        heatBand: computeHeatBand(heatScore),
      };
    });

    const latestHeatScore = points[points.length - 1]?.heatScore ?? 0;
    const peakHeatScore = points.reduce((max, point) => Math.max(max, point.heatScore), 0);
    const avgHeatScore = points.length > 0 ? Math.round((points.reduce((sum, point) => sum + point.heatScore, 0) / points.length) * 10) / 10 : 0;

    return {
      facilityId: facility.id,
      facilityName: facility.name,
      latestHeatScore,
      peakHeatScore,
      avgHeatScore,
      points,
    };
  });
}
