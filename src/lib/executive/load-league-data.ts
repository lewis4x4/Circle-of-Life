import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database, Json } from "@/types/database";
import { loadExecutiveKpiBulk } from "@/lib/executive/load-executive-kpi-bulk";
import {
  computeEntityInsuranceReadiness,
  computeLeagueRows,
  type BoardPacketSummary,
  type InsurancePolicyMini,
  type InsuranceRenewalMini,
  type LeagueFacilityBase,
  type LeagueFacilityRow,
  type RenewalDataPackageMini,
  type RiskSnapshotMini,
} from "@/lib/executive/league";

type EntityRow = { id: string; name: string };
type FacilityRow = {
  id: string;
  name: string;
  entity_id: string;
  total_licensed_beds: number;
};
type StandupSnapshotRow = {
  week_of: string;
  status: string;
  confidence_band: string;
  completeness_pct: number;
  published_version: number;
  published_at: string | null;
};
type RiskSnapshotRow = {
  facility_id: string;
  risk_score: number;
  risk_level: RiskSnapshotMini["level"];
  score_delta: number | null;
};
type SavedReportRow = Pick<
  Database["public"]["Tables"]["exec_saved_reports"]["Row"],
  "id" | "name" | "parameters" | "created_at" | "last_generated_at"
>;

export type ExecutiveLeagueData = {
  rows: LeagueFacilityRow[];
  insuranceRows: ReturnType<typeof computeEntityInsuranceReadiness>[];
  boardSummary: BoardPacketSummary;
};

function parseBoardPacketParameters(raw: Json): { kind: string | null; weekOf: string | null } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { kind: null, weekOf: null };
  }
  const value = raw as Record<string, unknown>;
  return {
    kind: typeof value.kind === "string" ? value.kind : null,
    weekOf: typeof value.weekOf === "string" ? value.weekOf : null,
  };
}

export async function loadExecutiveLeagueData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
): Promise<ExecutiveLeagueData> {
  const [facilitiesRes, entitiesRes, policiesRes, renewalsRes, packagesRes, riskRes, standupRes, reportsRes] = await Promise.all([
    supabase
      .from("facilities")
      .select("id, name, entity_id, total_licensed_beds")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("entities")
      .select("id, name")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("name"),
    supabase
      .from("insurance_policies")
      .select("id, entity_id, policy_number, carrier_name, policy_type, status, expiration_date")
      .eq("organization_id", organizationId)
      .is("deleted_at", null),
    supabase
      .from("insurance_renewals")
      .select("id, entity_id, insurance_policy_id, status, target_effective_date, renewal_data_package_id")
      .eq("organization_id", organizationId)
      .is("deleted_at", null),
    supabase
      .from("renewal_data_packages")
      .select("id, entity_id, generated_at, narrative_reviewed_at, narrative_published_at")
      .eq("organization_id", organizationId)
      .is("deleted_at", null),
    supabase
      .from("risk_score_snapshots" as never)
      .select("facility_id, risk_score, risk_level, score_delta")
      .eq("organization_id" as never, organizationId as never)
      .is("deleted_at" as never, null as never)
      .order("snapshot_date" as never, { ascending: false })
      .order("computed_at" as never, { ascending: false }),
    supabase
      .from("exec_standup_snapshots" as never)
      .select("week_of, status, confidence_band, completeness_pct, published_version, published_at")
      .eq("organization_id" as never, organizationId as never)
      .eq("status" as never, "published" as never)
      .is("deleted_at" as never, null as never)
      .order("week_of" as never, { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("exec_saved_reports")
      .select("id, name, parameters, created_at, last_generated_at")
      .eq("organization_id", organizationId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  if (facilitiesRes.error) throw facilitiesRes.error;
  if (entitiesRes.error) throw entitiesRes.error;
  if (policiesRes.error) throw policiesRes.error;
  if (renewalsRes.error) throw renewalsRes.error;
  if (packagesRes.error) throw packagesRes.error;
  if (riskRes.error) throw riskRes.error;
  if (standupRes.error) throw standupRes.error;
  if (reportsRes.error) throw reportsRes.error;

  const facilities = (facilitiesRes.data ?? []) as FacilityRow[];
  const entities = new Map(((entitiesRes.data ?? []) as EntityRow[]).map((entity) => [entity.id, entity.name]));
  const leagueFacilities: LeagueFacilityBase[] = facilities.map((facility) => ({
    facilityId: facility.id,
    facilityName: facility.name,
    entityId: facility.entity_id,
    entityName: entities.get(facility.entity_id) ?? facility.entity_id,
  }));

  const { facilityKpis: kpiMap } = await loadExecutiveKpiBulk(supabase, organizationId);

  const riskMap = new Map<string, RiskSnapshotMini>();
  for (const row of ((riskRes.data ?? []) as unknown as RiskSnapshotRow[])) {
    if (!riskMap.has(row.facility_id)) {
      riskMap.set(row.facility_id, {
        facilityId: row.facility_id,
        score: row.risk_score,
        level: row.risk_level,
        scoreDelta: row.score_delta,
      });
    }
  }

  const policies = ((policiesRes.data ?? []) as unknown as Array<{
    id: string;
    entity_id: string;
    policy_number: string;
    carrier_name: string;
    policy_type: string;
    status: string;
    expiration_date: string;
  }>).map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    policyNumber: row.policy_number,
    carrierName: row.carrier_name,
    policyType: row.policy_type,
    status: row.status,
    expirationDate: row.expiration_date,
  } satisfies InsurancePolicyMini));

  const renewals = ((renewalsRes.data ?? []) as unknown as Array<{
    id: string;
    entity_id: string;
    insurance_policy_id: string;
    status: string;
    target_effective_date: string;
    renewal_data_package_id: string | null;
  }>).map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    insurancePolicyId: row.insurance_policy_id,
    status: row.status,
    targetEffectiveDate: row.target_effective_date,
    renewalDataPackageId: row.renewal_data_package_id,
  } satisfies InsuranceRenewalMini));

  const packets = ((packagesRes.data ?? []) as unknown as Array<{
    id: string;
    entity_id: string;
    generated_at: string;
    narrative_reviewed_at: string | null;
    narrative_published_at: string | null;
  }>).map((row) => ({
    id: row.id,
    entityId: row.entity_id,
    generatedAt: row.generated_at,
    reviewedAt: row.narrative_reviewed_at,
    publishedAt: row.narrative_published_at,
  } satisfies RenewalDataPackageMini));

  const insuranceRows = Array.from(new Set(leagueFacilities.map((facility) => facility.entityId)))
    .map((entityId) =>
      computeEntityInsuranceReadiness({
        entityId,
        entityName: entities.get(entityId) ?? entityId,
        policies: policies.filter((policy) => policy.entityId === entityId),
        renewals: renewals.filter((renewal) => renewal.entityId === entityId),
        packages: packets.filter((packet) => packet.entityId === entityId),
      }),
    )
    .sort((left, right) => right.readinessScore - left.readinessScore);
  const insuranceMap = new Map(insuranceRows.map((row) => [row.entityId, row]));

  const boardPacketReports = ((reportsRes.data ?? []) as SavedReportRow[]).filter((row) => {
    const params = parseBoardPacketParameters(row.parameters);
    return params.kind === "executive_standup_board_packet";
  });
  const latestStandup = standupRes.data as unknown as StandupSnapshotRow | null;
  const boardSummary: BoardPacketSummary = {
    weekOf: latestStandup?.week_of ?? null,
    status: latestStandup?.status ?? null,
    confidenceBand: latestStandup?.confidence_band ?? null,
    completenessPct: latestStandup?.completeness_pct ?? null,
    publishedVersion: latestStandup?.published_version ?? null,
    publishedAt: latestStandup?.published_at ?? null,
    savedPacketCount: boardPacketReports.length,
    lastSavedAt: boardPacketReports[0]?.last_generated_at ?? boardPacketReports[0]?.created_at ?? null,
  };

  return {
    rows: computeLeagueRows({
      facilities: leagueFacilities,
      kpis: kpiMap,
      riskSnapshots: riskMap,
      insuranceReadinessByEntity: insuranceMap,
      boardSummary,
    }),
    insuranceRows,
    boardSummary,
  };
}
