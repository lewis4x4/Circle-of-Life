import {
  applyNormalizedScopeFilters,
  applyReplacementScopeFilters,
  buildReplacementScopes,
  normalizedRowsForScope,
} from "./normalized-metrics.ts";

Deno.test("normalizedRowsForScope builds org/entity/facility scoped rows", () => {
  const baseMetrics = [
    { code: "occ_pt", value: 0.91, statusColor: "green" },
  ] as const;

  const orgRows = normalizedRowsForScope({
    organizationId: "org-1",
    snapshotDate: "2026-05-18",
    sourceVersion: 1,
    entityId: null,
    facilityId: null,
    metrics: baseMetrics as never,
  });
  const entityRows = normalizedRowsForScope({
    organizationId: "org-1",
    snapshotDate: "2026-05-18",
    sourceVersion: 1,
    entityId: "ent-1",
    facilityId: null,
    metrics: baseMetrics as never,
  });
  const facilityRows = normalizedRowsForScope({
    organizationId: "org-1",
    snapshotDate: "2026-05-18",
    sourceVersion: 1,
    entityId: "ent-1",
    facilityId: "fac-1",
    metrics: baseMetrics as never,
  });

  if (orgRows[0]) {
    if (orgRows[0].entity_id !== null || orgRows[0].facility_id !== null) {
      throw new Error("org row scope mismatch");
    }
  }
  if (entityRows[0]) {
    if (entityRows[0].entity_id !== "ent-1" || entityRows[0].facility_id !== null) {
      throw new Error("entity row scope mismatch");
    }
  }
  if (facilityRows[0]) {
    if (facilityRows[0].entity_id !== "ent-1" || facilityRows[0].facility_id !== "fac-1") {
      throw new Error("facility row scope mismatch");
    }
  }
});

Deno.test("buildReplacementScopes includes org + exact entity scopes + facility-stable scopes", () => {
  const scopes = buildReplacementScopes({
    entityIds: ["ent-1", "ent-2", "ent-1"],
    facilityIds: ["fac-1", "fac-2", "fac-1"],
  });

  const expected = [
    { entity_id: null, facility_id: null },
    { entity_id: "ent-1", facility_id: null },
    { entity_id: "ent-2", facility_id: null },
    { entity_id: null, facility_id: "fac-1" },
    { entity_id: null, facility_id: "fac-2" },
  ];

  if (JSON.stringify(scopes) !== JSON.stringify(expected)) {
    throw new Error(`unexpected scopes: ${JSON.stringify(scopes)}`);
  }
});

Deno.test("applyNormalizedScopeFilters matches nullable entity/facility scope exactly", () => {
  const calls: string[] = [];
  const query = {
    eq(column: string, value: string) {
      calls.push(`eq:${column}:${value}`);
      return this;
    },
    is(column: string, value: null) {
      calls.push(`is:${column}:${String(value)}`);
      return this;
    },
  };

  applyNormalizedScopeFilters(query, { entity_id: null, facility_id: null });
  applyNormalizedScopeFilters(query, { entity_id: "ent-1", facility_id: null });
  applyNormalizedScopeFilters(query, { entity_id: "ent-1", facility_id: "fac-1" });

  const expected = [
    "is:entity_id:null",
    "is:facility_id:null",
    "eq:entity_id:ent-1",
    "is:facility_id:null",
    "eq:entity_id:ent-1",
    "eq:facility_id:fac-1",
  ];

  if (JSON.stringify(calls) !== JSON.stringify(expected)) {
    throw new Error(`unexpected filter calls: ${JSON.stringify(calls)}`);
  }
});

Deno.test("applyReplacementScopeFilters uses facility_id as stable identity for facility scope deletes", () => {
  const calls: string[] = [];
  const query = {
    eq(column: string, value: string) {
      calls.push(`eq:${column}:${value}`);
      return this;
    },
    is(column: string, value: null) {
      calls.push(`is:${column}:${String(value)}`);
      return this;
    },
  };

  applyReplacementScopeFilters(query, { entity_id: null, facility_id: "fac-1" });

  const expected = ["eq:facility_id:fac-1"];
  if (JSON.stringify(calls) !== JSON.stringify(expected)) {
    throw new Error(`unexpected facility scope calls: ${JSON.stringify(calls)}`);
  }
});
