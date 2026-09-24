import type { SupabaseClient } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/client";
import { readAllPages } from "@/lib/supabase/read-all-pages";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { requireHeadCount } from "@/lib/metrics/head-count";

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
  /**
   * False when nothing has ever been recorded for this facility. Its counts are
   * then absences of records, not observed zeros, and must not read as stable.
   */
  observed: boolean;
  /** Most recent recorded resident safety scoring (ISO), or null when none exists. */
  lastObservedAt: string | null;
};

export type ResidentAssuranceFacilityTrendPoint = {
  date: string;
  watchStarts: number;
  escalations: number;
  integrityFlags: number;
  criticalResidents: number;
  heatScore: number;
  heatBand: ResidentAssuranceFacilityRollup["heatBand"];
  /**
   * True only when something was recorded for this facility on this day. An
   * unobserved day is a gap in the series, never a healthy zero.
   */
  observed: boolean;
};

export type ResidentAssuranceFacilityTrendRow = {
  facilityId: string;
  facilityName: string;
  latestHeatScore: number;
  peakHeatScore: number;
  avgHeatScore: number;
  points: ResidentAssuranceFacilityTrendPoint[];
  /** Days in the window with a recorded observation. */
  observedDays: number;
  /** Days in the window. `observedDays` of `days` is the coverage of this row. */
  days: number;
  /** Most recent day with a recorded observation (YYYY-MM-DD), or null. */
  lastObservedDate: string | null;
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

type LatestScoreRow = {
  facility_id: string;
  resident_id: string;
  score: number;
  risk_tier: "low" | "moderate" | "high" | "critical";
  computed_at: string;
  resident?: { first_name: string; last_name: string; preferred_name: string | null };
};

type CountReply = { count: number | null; error: { message: string } | null };

type ResidentLatestScoreRow = {
  id: string;
  facility_id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  resident_safety_scores: Array<Pick<LatestScoreRow, "score" | "risk_tier" | "computed_at">> | null;
};

/**
 * The newest safety score of every resident in scope: one row per resident
 * (paged, so no cap can drop anyone) with the score history limited to its
 * newest row per resident by PostgREST. Critical / high safety figures are
 * tallied from this — never from a capped select of score history, which
 * dropped residents once history outgrew the cap (COL-640).
 */
async function readLatestSafetyScores(
  supabase: SupabaseClient<Database>,
  scope: { organizationId?: string; facilityId?: string | null },
): Promise<LatestScoreRow[]> {
  const residents = await readAllPages<ResidentLatestScoreRow>((start, end) => {
    let query = supabase
      .from("residents" as never)
      .select(
        "id, facility_id, first_name, last_name, preferred_name, resident_safety_scores(score, risk_tier, computed_at)",
        { count: "exact" },
      )
      .is("deleted_at", null)
      .is("resident_safety_scores.deleted_at", null)
      .order("computed_at", { referencedTable: "resident_safety_scores", ascending: false })
      .limit(1, { referencedTable: "resident_safety_scores" });
    if (scope.organizationId) query = query.eq("organization_id", scope.organizationId);
    if (scope.facilityId && isValidFacilityIdForQuery(scope.facilityId)) query = query.eq("facility_id", scope.facilityId);
    return query.order("id", { ascending: true }).range(start, end) as unknown as PromiseLike<{
      data: ResidentLatestScoreRow[] | null;
      count: number | null;
      error: { message: string } | null;
    }>;
  });
  const latest: LatestScoreRow[] = [];
  for (const resident of residents.data) {
    const score = resident.resident_safety_scores?.[0];
    if (!score) continue;
    latest.push({ ...score, facility_id: resident.facility_id, resident_id: resident.id, resident });
  }
  return latest;
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
    latestScores,
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
    readLatestSafetyScores(supabase, { facilityId }),
  ]);

  const firstError = [
    activeWatchesRes.error,
    pendingWatchApprovalsRes.error,
    openEscalationsRes.error,
    openIntegrityFlagsRes.error,
  ].find(Boolean);
  if (firstError) {
    throw new Error(firstError.message);
  }

  const highOrCritical = latestScores.filter((row) => row.risk_tier === "critical" || row.risk_tier === "high");

  return {
    activeWatches: requireHeadCount(activeWatchesRes, "Active watches"),
    pendingWatchApprovals: requireHeadCount(pendingWatchApprovalsRes, "Pending watch approvals"),
    openEscalations: requireHeadCount(openEscalationsRes, "Open escalations"),
    openIntegrityFlags: requireHeadCount(openIntegrityFlagsRes, "Open integrity flags"),
    criticalSafetyResidents: latestScores.filter((row) => row.risk_tier === "critical").length,
    highOrCriticalSafetyResidents: highOrCritical.length,
    highRiskResidents: highOrCritical
      .sort((a, b) => a.score - b.score)
      .slice(0, 4)
      .map((row) => ({
        id: row.resident_id,
        name: residentName(row.resident, row.resident_id.slice(0, 8)),
        riskTier: row.risk_tier,
        score: row.score,
      })),
  };
}

export async function fetchResidentAssuranceFacilityHeatMap(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ResidentAssuranceFacilityRollup[]> {
  const facilitiesRequest = supabase
    .from("facilities")
    .select("id, name")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("name", { ascending: true });
  const latestScoresRequest = readLatestSafetyScores(supabase, { organizationId });

  const facilitiesRes = await facilitiesRequest;
  if (facilitiesRes.error) {
    throw new Error(facilitiesRes.error.message);
  }
  const facilities = facilitiesRes.data ?? [];

  const countFor = (table: string, facilityId: string, statuses: string[]) =>
    supabase
      .from(table as never)
      .select("id", { count: "exact", head: true })
      .eq("organization_id", organizationId)
      .eq("facility_id", facilityId)
      .in("status", statuses)
      .is("deleted_at", null) as unknown as PromiseLike<CountReply>;

  const [perFacility, latestScores] = await Promise.all([
    Promise.all(
      facilities.map((facility) =>
        Promise.all([
          countFor("resident_watch_instances", facility.id, ["active"]),
          countFor("resident_watch_instances", facility.id, ["pending_approval"]),
          countFor("resident_observation_escalations", facility.id, ["open", "in_progress"]),
          countFor("resident_observation_integrity_flags", facility.id, ["open", "in_progress"]),
        ]),
      ),
    ),
    latestScoresRequest,
  ]);

  const countError = perFacility.flat().find((reply) => reply.error)?.error;
  if (countError) {
    throw new Error(countError.message);
  }

  const criticalByFacility = new Map<string, number>();
  const highOrCriticalByFacility = new Map<string, number>();
  const lastScoredAtByFacility = new Map<string, string>();
  for (const row of latestScores) {
    if (row.risk_tier === "critical") {
      criticalByFacility.set(row.facility_id, (criticalByFacility.get(row.facility_id) ?? 0) + 1);
    }
    if (row.risk_tier === "critical" || row.risk_tier === "high") {
      highOrCriticalByFacility.set(row.facility_id, (highOrCriticalByFacility.get(row.facility_id) ?? 0) + 1);
    }
    const seen = lastScoredAtByFacility.get(row.facility_id);
    if (!seen || row.computed_at > seen) {
      lastScoredAtByFacility.set(row.facility_id, row.computed_at);
    }
  }

  return facilities.map((facility, index) => {
    const [activeRes, pendingRes, escalationsRes, integrityRes] = perFacility[index]!;
    const activeWatches = requireHeadCount(activeRes, "Active watches");
    const pendingWatchApprovals = requireHeadCount(pendingRes, "Pending watch approvals");
    const openEscalations = requireHeadCount(escalationsRes, "Open escalations");
    const openIntegrityFlags = requireHeadCount(integrityRes, "Open integrity flags");
    const criticalSafetyResidents = criticalByFacility.get(facility.id) ?? 0;
    const highOrCriticalSafetyResidents = highOrCriticalByFacility.get(facility.id) ?? 0;
    const heatScore =
      pendingWatchApprovals * 2 +
      openEscalations * 3 +
      openIntegrityFlags * 2 +
      criticalSafetyResidents * 4 +
      Math.max(0, highOrCriticalSafetyResidents - criticalSafetyResidents);

    const lastObservedAt = lastScoredAtByFacility.get(facility.id) ?? null;
    const observed =
      lastObservedAt !== null ||
      activeWatches > 0 ||
      pendingWatchApprovals > 0 ||
      openEscalations > 0 ||
      openIntegrityFlags > 0;

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
      observed,
      lastObservedAt,
    };
  });
}

type PagedReply<T> = { data: T[] | null; count?: number | null; error: { message: string } | null };

const TREND_PAGE_SIZE = 500;

/**
 * Every row a paged read has, answered in the `{ data, error }` shape of a single
 * select so response errors keep their priority; transport rejections still reject.
 */
async function readAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PagedReply<T>>,
): Promise<{ data: T[] | null; error: { message: string } | null }> {
  const rows: T[] = [];
  const done = (data: T[], total: number | null) =>
    data.length === 0 || (total !== null ? rows.length >= total : data.length < TREND_PAGE_SIZE);

  const first = await fetchPage(0, TREND_PAGE_SIZE - 1);
  if (first.error) return { data: null, error: first.error };
  const firstData = first.data ?? [];
  rows.push(...firstData);
  const total = first.count ?? null;
  if (done(firstData, total)) return { data: rows, error: null };

  // COL-674: with the total known, read the remaining pages at once instead of
  // one round trip each. The stride is what the server actually returned, so a
  // lower hosted row cap shrinks the pages rather than skipping rows.
  if (total !== null) {
    const stride = firstData.length;
    const offsets: number[] = [];
    for (let from = stride; from < total; from += stride) offsets.push(from);
    const pages = await Promise.all(offsets.map((from) => fetchPage(from, from + stride - 1)));
    for (const page of pages) {
      if (page.error) return { data: null, error: page.error };
      rows.push(...(page.data ?? []));
    }
    if (rows.length >= total) return { data: rows, error: null };
  }

  // Rows changed between pages, or no total: finish one page at a time.
  for (;;) {
    const page = await fetchPage(rows.length, rows.length + TREND_PAGE_SIZE - 1);
    if (page.error) return { data: null, error: page.error };
    const data = page.data ?? [];
    rows.push(...data);
    if (done(data, page.count ?? null)) return { data: rows, error: null };
  }
}

export async function fetchResidentAssuranceFacilityTrendSeries(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  days = 7,
): Promise<ResidentAssuranceFacilityTrendRow[]> {
  const dates = buildTrailingDates(days);
  const startDate = `${dates[0]}T00:00:00.000Z`;

  // Dated rows are paged: at Homewood one week of escalations is already past
  // PostgREST's 1000-row cap, and a truncated select tallied per day understates
  // every day it drops (COL-640).
  const results = await Promise.allSettled([
    supabase
      .from("facilities")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name", { ascending: true }),
    readAllRows<{ facility_id: string; starts_at: string }>((from, to) =>
      supabase
        .from("resident_watch_instances" as never)
        .select("id, facility_id, starts_at", { count: "exact" })
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .gte("starts_at", startDate)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedReply<{ facility_id: string; starts_at: string }>>,
    ),
    readAllRows<{ facility_id: string; triggered_at: string }>((from, to) =>
      supabase
        .from("resident_observation_escalations" as never)
        .select("id, facility_id, triggered_at", { count: "exact" })
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .gte("triggered_at", startDate)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedReply<{ facility_id: string; triggered_at: string }>>,
    ),
    readAllRows<{ facility_id: string; detected_at: string }>((from, to) =>
      supabase
        .from("resident_observation_integrity_flags" as never)
        .select("id, facility_id, detected_at", { count: "exact" })
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .gte("detected_at", startDate)
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedReply<{ facility_id: string; detected_at: string }>>,
    ),
    readAllRows<{
      facility_id: string;
      resident_id: string;
      risk_tier: "low" | "moderate" | "high" | "critical";
      computed_at: string;
    }>((from, to) =>
      supabase
        .from("resident_safety_scores" as never)
        .select("facility_id, resident_id, risk_tier, computed_at", { count: "exact" })
        .eq("organization_id", organizationId)
        .is("deleted_at", null)
        .gte("computed_at", startDate)
        .order("computed_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to) as unknown as PromiseLike<PagedReply<{
        facility_id: string;
        resident_id: string;
        risk_tier: "low" | "moderate" | "high" | "critical";
        computed_at: string;
      }>>,
    ),
  ]);

  // Preserve sequential rejection priority, then the existing response-error priority.
  // allSettled also consumes every rejection from these independent reads.
  function value<T>(result: PromiseSettledResult<T>): T {
    if (result.status === "rejected") throw result.reason;
    return result.value;
  }
  const facilitiesRes = value(results[0]);
  const watchStartsRes = value(results[1]);
  const escalationsRes = value(results[2]);
  const integrityRes = value(results[3]);
  const safetyScoresRes = value(results[4]);

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

  // A day counts as observed when the assurance engine recorded anything for
  // that facility — a scoring run or any watch, escalation or integrity entry.
  // Days with no record are gaps in the series; a zero is only meaningful on a
  // day something was actually recorded.
  const observedKeys = new Set<string>();
  for (const row of latestScoreByResidentDay.values()) {
    observedKeys.add(`${row.facility_id}:${row.date}`);
  }
  for (const key of [...watchStartsByKey.keys(), ...escalationsByKey.keys(), ...integrityByKey.keys()]) {
    observedKeys.add(key);
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
        observed: observedKeys.has(key),
      };
    });

    const latestHeatScore = points[points.length - 1]?.heatScore ?? 0;
    const peakHeatScore = points.reduce((max, point) => Math.max(max, point.heatScore), 0);
    const avgHeatScore = points.length > 0 ? Math.round((points.reduce((sum, point) => sum + point.heatScore, 0) / points.length) * 10) / 10 : 0;

    const observedPoints = points.filter((point) => point.observed);

    return {
      facilityId: facility.id,
      facilityName: facility.name,
      latestHeatScore,
      peakHeatScore,
      avgHeatScore,
      points,
      observedDays: observedPoints.length,
      days: points.length,
      lastObservedDate: observedPoints[observedPoints.length - 1]?.date ?? null,
    };
  });
}
