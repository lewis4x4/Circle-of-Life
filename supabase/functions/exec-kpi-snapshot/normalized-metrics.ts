import type { ExecDashboardMetric } from "../_shared/exec-kpi-metrics.ts";

type FilterableQuery<TQuery = unknown> = {
  eq: (column: string, value: string) => TQuery;
  is: (column: string, value: null) => TQuery;
};

export type NormalizedMetricRow = {
  organization_id: string;
  metric_code: ExecDashboardMetric["code"];
  entity_id: string | null;
  facility_id: string | null;
  snapshot_date: string;
  period_type: "daily";
  metric_value_numeric: number;
  status_color: ExecDashboardMetric["statusColor"];
  source_version: number;
};

export type NormalizedReplacementScope =
  | { entity_id: null; facility_id: null }
  | { entity_id: string; facility_id: null }
  | { entity_id: null; facility_id: string };

export function normalizedRowsForScope(input: {
  organizationId: string;
  snapshotDate: string;
  sourceVersion: number;
  entityId: string | null;
  facilityId: string | null;
  metrics: ExecDashboardMetric[];
}): NormalizedMetricRow[] {
  return input.metrics.map((metric) => ({
    organization_id: input.organizationId,
    metric_code: metric.code,
    entity_id: input.entityId,
    facility_id: input.facilityId,
    snapshot_date: input.snapshotDate,
    period_type: "daily",
    metric_value_numeric: metric.value,
    status_color: metric.statusColor,
    source_version: input.sourceVersion,
  }));
}

export function buildReplacementScopes(input: {
  entityIds: string[];
  facilityIds: string[];
}): NormalizedReplacementScope[] {
  const scopes: NormalizedReplacementScope[] = [{ entity_id: null, facility_id: null }];

  for (const entityId of new Set(input.entityIds)) {
    scopes.push({ entity_id: entityId, facility_id: null });
  }
  for (const facilityId of new Set(input.facilityIds)) {
    scopes.push({ entity_id: null, facility_id: facilityId });
  }

  return scopes;
}

export function applyNormalizedScopeFilters<TQuery extends FilterableQuery<TQuery>>(
  query: TQuery,
  row: Pick<NormalizedMetricRow, "entity_id" | "facility_id">,
): TQuery {
  const entityScoped = row.entity_id
    ? query.eq("entity_id", row.entity_id)
    : query.is("entity_id", null);

  return row.facility_id
    ? entityScoped.eq("facility_id", row.facility_id)
    : entityScoped.is("facility_id", null);
}

export function applyReplacementScopeFilters<TQuery extends FilterableQuery<TQuery>>(
  query: TQuery,
  scope: NormalizedReplacementScope,
): TQuery {
  if (scope.facility_id) {
    return query.eq("facility_id", scope.facility_id);
  }

  return applyNormalizedScopeFilters(query, scope);
}
