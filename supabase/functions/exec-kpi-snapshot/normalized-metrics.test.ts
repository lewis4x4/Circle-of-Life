import type { ExecDashboardMetric } from "../_shared/exec-kpi-metrics.ts";

import { normalizedRowsForScope } from "./normalized-metrics.ts";

Deno.test("normalizedRowsForScope builds org/entity/facility scoped rows", () => {
  const baseMetrics: ExecDashboardMetric[] = [
    { code: "occ_pt", value: 0.91, statusColor: "green" },
  ];

  const orgRows = normalizedRowsForScope({
    organizationId: "org-1",
    snapshotDate: "2026-05-18",
    sourceVersion: 1,
    entityId: null,
    facilityId: null,
    metrics: baseMetrics,
  });
  const entityRows = normalizedRowsForScope({
    organizationId: "org-1",
    snapshotDate: "2026-05-18",
    sourceVersion: 1,
    entityId: "ent-1",
    facilityId: null,
    metrics: baseMetrics,
  });
  const facilityRows = normalizedRowsForScope({
    organizationId: "org-1",
    snapshotDate: "2026-05-18",
    sourceVersion: 1,
    entityId: "ent-1",
    facilityId: "fac-1",
    metrics: baseMetrics,
  });

  if (orgRows[0]?.entity_id !== null || orgRows[0]?.facility_id !== null) {
    throw new Error("org row scope mismatch");
  }
  if (entityRows[0]?.entity_id !== "ent-1" || entityRows[0]?.facility_id !== null) {
    throw new Error("entity row scope mismatch");
  }
  if (facilityRows[0]?.entity_id !== "ent-1" || facilityRows[0]?.facility_id !== "fac-1") {
    throw new Error("facility row scope mismatch");
  }
});

Deno.test("normalizedRowsForScope returns no rows when there are no dashboard metrics", () => {
  const rows = normalizedRowsForScope({
    organizationId: "org-1",
    snapshotDate: "2026-05-18",
    sourceVersion: 1,
    entityId: null,
    facilityId: null,
    metrics: [],
  });

  if (rows.length !== 0) {
    throw new Error(`expected no rows, got ${rows.length}`);
  }
});
