import type { SupabaseClient } from "@supabase/supabase-js";

import type { ExecKpiPayload } from "@/lib/exec-kpi-snapshot";
import { EXEC_KPI_METRICS_VERSION } from "@/lib/exec-kpi-snapshot";
import type { Database } from "@/types/database";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

/**
 * Latest persisted `exec_kpi_snapshots.metrics` for the same scope as the live command center
 * (organization-wide or single facility). Used for deltas vs cron snapshots.
 */
export async function fetchPriorExecSnapshotMetrics(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string | null,
): Promise<ExecKpiPayload | null> {
  const scoped = isValidFacilityIdForQuery(facilityId);
  const scopeType: Database["public"]["Enums"]["exec_snapshot_scope"] = scoped ? "facility" : "organization";
  const scopeId = scoped ? facilityId! : organizationId;

  const { data, error } = await supabase
    .from("exec_kpi_snapshots")
    .select("metrics")
    .eq("organization_id", organizationId)
    .eq("scope_type", scopeType)
    .eq("scope_id", scopeId)
    .is("deleted_at", null)
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data?.metrics) return null;
  const raw = data.metrics as unknown;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Partial<ExecKpiPayload>;
  if (o.version !== EXEC_KPI_METRICS_VERSION) return null;
  return o as ExecKpiPayload;
}

const money0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function vsSnapshot(parts: string[]): string | null {
  const p = parts.filter(Boolean);
  if (p.length === 0) return "Flat vs last snapshot";
  return `vs last snapshot: ${p.join(" · ")}`;
}

export function censusDeltaLine(current: ExecKpiPayload, prior: ExecKpiPayload | null): string | null {
  if (!prior) return null;
  const parts: string[] = [];
  const dr = current.census.occupiedResidents - prior.census.occupiedResidents;
  if (dr !== 0) parts.push(`${dr > 0 ? "+" : ""}${dr} residents`);
  if (current.census.occupancyPct != null && prior.census.occupancyPct != null) {
    const d = current.census.occupancyPct - prior.census.occupancyPct;
    if (Math.abs(d) >= 0.05) parts.push(`${d > 0 ? "+" : ""}${d.toFixed(1)}pp occ.`);
  }
  return vsSnapshot(parts);
}

export function arDeltaLine(current: ExecKpiPayload, prior: ExecKpiPayload | null): string | null {
  if (!prior) return null;
  const parts: string[] = [];
  const dOpen = current.financial.openInvoicesCount - prior.financial.openInvoicesCount;
  if (dOpen !== 0) parts.push(`${dOpen > 0 ? "+" : ""}${dOpen} open`);
  const dBal = current.financial.totalBalanceDueCents - prior.financial.totalBalanceDueCents;
  if (dBal !== 0) parts.push(`${dBal > 0 ? "+" : ""}${money0.format(dBal / 100)} AR`);
  return vsSnapshot(parts);
}

export function clinicalDeltaLine(current: ExecKpiPayload, prior: ExecKpiPayload | null): string | null {
  if (!prior) return null;
  const parts: string[] = [];
  const di = current.clinical.openIncidents - prior.clinical.openIncidents;
  if (di !== 0) parts.push(`${di > 0 ? "+" : ""}${di} incidents`);
  const dm = current.clinical.medicationErrorsMtd - prior.clinical.medicationErrorsMtd;
  if (dm !== 0) parts.push(`${dm > 0 ? "+" : ""}${dm} med err.`);
  return vsSnapshot(parts);
}

export function complianceDeltaLine(current: ExecKpiPayload, prior: ExecKpiPayload | null): string | null {
  if (!prior) return null;
  const d = current.compliance.openSurveyDeficiencies - prior.compliance.openSurveyDeficiencies;
  const parts: string[] = [];
  if (d !== 0) parts.push(`${d > 0 ? "+" : ""}${d} deficiencies`);
  return vsSnapshot(parts);
}

export function workforceDeltaLine(current: ExecKpiPayload, prior: ExecKpiPayload | null): string | null {
  if (!prior) return null;
  const d = current.workforce.certificationsExpiring30d - prior.workforce.certificationsExpiring30d;
  const parts: string[] = [];
  if (d !== 0) parts.push(`${d > 0 ? "+" : ""}${d} expiring 30d`);
  return vsSnapshot(parts);
}

export function infectionDeltaLine(current: ExecKpiPayload, prior: ExecKpiPayload | null): string | null {
  if (!prior) return null;
  const d = current.infection.activeOutbreaks - prior.infection.activeOutbreaks;
  const parts: string[] = [];
  if (d !== 0) parts.push(`${d > 0 ? "+" : ""}${d} outbreaks`);
  return vsSnapshot(parts);
}
