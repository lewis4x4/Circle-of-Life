import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHandler } from "../index.ts";
import { valuesDiffer } from "../promoters/_helpers.ts";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const FACILITY_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";

Deno.test("valuesDiffer treats reordered jsonb objects as equal", () => {
  assertEquals(
    valuesDiffer(
      {
        field_path: "billingCycle",
        module_code: "M6",
        source: "facility-launch-promote",
      },
      {
        source: "facility-launch-promote",
        module_code: "M6",
        field_path: "billingCycle",
      },
    ),
    false,
  );
  assertEquals(
    valuesDiffer({ nested: { b: 2, a: 1 } }, { nested: { a: 1, b: 2 } }),
    false,
  );
  assertEquals(valuesDiffer({ nested: { a: 1 } }, { nested: { a: 2 } }), true);
});

type Row = Record<string, unknown>;
type Filter = { kind: "eq" | "is" | "in"; column: string; value: unknown };

class FakeQuery {
  private filters: Filter[] = [];
  private operation: "select" | "insert" | "update" = "select";
  private payload: unknown;

  constructor(private db: FakeAdminClient, private table: string) {}

  select(_columns = "*") {
    return this;
  }

  eq(column: string, value: unknown) {
    this.filters.push({ kind: "eq", column, value });
    return this;
  }

  is(column: string, value: unknown) {
    this.filters.push({ kind: "is", column, value });
    return this;
  }

  in(column: string, value: unknown[]) {
    this.filters.push({ kind: "in", column, value });
    return this;
  }

  insert(payload: unknown) {
    this.operation = "insert";
    this.payload = payload;
    return this;
  }

  update(payload: unknown) {
    this.operation = "update";
    this.payload = payload;
    return this;
  }

  async single() {
    const result = this.execute();
    const data = result.data[0];
    return data
      ? { data, error: null }
      : { data: null, error: { message: "No rows" } };
  }

  async maybeSingle() {
    const result = this.execute();
    return { data: result.data[0] ?? null, error: null };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?:
      | ((
        value: { data: Row[]; error: null },
      ) => TResult1 | PromiseLike<TResult1>)
      | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute() as { data: Row[]; error: null }).then(
      onfulfilled,
      onrejected,
    );
  }

  private execute(): { data: Row[]; error: null } {
    this.db.recordQuery(this.table, this.operation);
    if (this.operation === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload])
        .map((row) => this.db.insert(this.table, row as Row));
      return { data: rows, error: null };
    }
    if (this.operation === "update") {
      const rows = this.db.select(this.table).filter((row) =>
        this.matches(row)
      );
      for (const row of rows) Object.assign(row, this.payload as Row);
      return { data: rows, error: null };
    }
    return {
      data: this.db.select(this.table).filter((row) => this.matches(row)),
      error: null,
    };
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      const actual = row[filter.column];
      if (filter.kind === "is" && filter.value === null) {
        return actual === null || actual === undefined;
      }
      if (filter.kind === "in") {
        return Array.isArray(filter.value) &&
          filter.value.includes(actual as never);
      }
      return actual === filter.value;
    });
  }
}

class FakeAdminClient {
  public auth = {
    getUser: (token: string) =>
      token === "valid"
        ? Promise.resolve({ data: { user: { id: USER_ID } }, error: null })
        : Promise.resolve({
          data: { user: null },
          error: { message: "bad token" },
        }),
  };
  private counters: Record<string, number> = {};
  public tables: Record<string, Row[]>;
  public rpcCalls: Array<{ fn: string; args: Record<string, unknown> }> = [];
  public failScalarRpc = false;
  public failScalarRpcAfterFirstWrite = false;
  private queryCounts: Record<string, Record<string, number>> = {};

  constructor(moduleValues: Row[]) {
    this.tables = {
      user_profiles: [{
        id: USER_ID,
        app_role: "owner",
        organization_id: ORG_ID,
        is_active: true,
        deleted_at: null,
      }],
      facilities: [{
        id: FACILITY_ID,
        organization_id: ORG_ID,
        name: "Homewood Lodge ALF",
        deleted_at: null,
      }],
      organizations: [{ id: ORG_ID, name: "Circle of Life", deleted_at: null }],
      user_facility_access: [],
      facility_launch_module_values: moduleValues,
      facility_launch_promotion_runs: [],
      facility_launch_promotion_run_items: [],
      facility_launch_promotion_run_links: [],
      facility_billing_config: [],
      facility_medication_config: [],
      facility_dining_config: [],
      facility_maintenance_config: [],
      facility_admissions_config: [],
      facility_incident_config: [],
      facility_vendor_config: [],
      facility_launch_scoreboard_config: [],
      incident_workflow_templates: [],
      facility_vendors: [],
      facility_kpi_definitions: [],
      rate_schedule_versions: [],
    };
  }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQuery(this, table);
  }

  recordQuery(table: string, operation: string) {
    const entry = this.queryCounts[table] ?? {};
    entry[operation] = (entry[operation] ?? 0) + 1;
    this.queryCounts[table] = entry;
  }

  queryCount(table: string, operation: "select" | "insert" | "update") {
    return this.queryCounts[table]?.[operation] ?? 0;
  }

  async rpc(fn: string, args: Record<string, unknown>) {
    this.rpcCalls.push({ fn, args });
    if (fn !== "promote_facility_launch_scalar_config") {
      return { data: null, error: { message: `Unsupported rpc ${fn}` } };
    }
    if (this.failScalarRpc) {
      return { data: null, error: { message: "Injected scalar RPC failure" } };
    }

    const table = String(args.p_table ?? "");
    const runItemId = args.p_run_item_id ? String(args.p_run_item_id) : null;
    const rows = Array.isArray(args.p_rows) ? args.p_rows as Row[] : [];

    const snapshot = this.tables[table].map((row) => ({ ...row }));
    const linksSnapshot = this.tables.facility_launch_promotion_run_links.map((row) => ({ ...row }));
    const tableCounter = this.counters[table] ?? 0;
    const linkCounter = this.counters.facility_launch_promotion_run_links ?? 0;

    try {
      let created = 0;
      let updated = 0;
      let noop = 0;
      for (const rawRow of rows) {
        const fieldPath = String(rawRow.field_path ?? "").trim();
        if (!fieldPath) continue;
        const existing = this.tables[table].find((row) =>
          row.organization_id === args.p_organization_id &&
          row.facility_id === args.p_facility_id &&
          row.field_path === fieldPath &&
          (row.deleted_at === null || row.deleted_at === undefined)
        );

        const updatePayload = {
          value: rawRow.value,
          provenance: rawRow.provenance,
          promoted_from_module_value_id: rawRow.promoted_from_module_value_id ?? null,
          updated_by: args.p_actor_user_id,
        };

        if (!existing) {
          const inserted = this.insert(table, {
            organization_id: args.p_organization_id,
            facility_id: args.p_facility_id,
            field_path: fieldPath,
            ...updatePayload,
            created_by: args.p_actor_user_id,
            deleted_at: null,
          });
          created += 1;
          if (this.failScalarRpcAfterFirstWrite && created + updated === 1) {
            throw new Error("Injected scalar RPC failure after first write");
          }
          if (runItemId) {
            this.insert("facility_launch_promotion_run_links", {
              run_item_id: runItemId,
              organization_id: args.p_organization_id,
              facility_id: args.p_facility_id,
              module_value_id: updatePayload.promoted_from_module_value_id,
              target_table: table,
              target_row_id: String(inserted.id),
              action: "insert",
              before_value: null,
              after_value: {
                organization_id: args.p_organization_id,
                facility_id: args.p_facility_id,
                field_path: fieldPath,
                ...updatePayload,
              },
            });
          }
          continue;
        }

        const changed = valuesDiffer(existing.value, updatePayload.value) ||
          valuesDiffer(existing.provenance, updatePayload.provenance) ||
          valuesDiffer(
            existing.promoted_from_module_value_id ?? null,
            updatePayload.promoted_from_module_value_id ?? null,
          ) ||
          valuesDiffer(existing.updated_by ?? null, updatePayload.updated_by ?? null);

        if (!changed) {
          noop += 1;
          continue;
        }

        const beforeValue = { ...existing };
        Object.assign(existing, updatePayload);
        updated += 1;
        if (this.failScalarRpcAfterFirstWrite && created + updated === 1) {
          throw new Error("Injected scalar RPC failure after first write");
        }
        if (runItemId) {
          this.insert("facility_launch_promotion_run_links", {
            run_item_id: runItemId,
            organization_id: args.p_organization_id,
            facility_id: args.p_facility_id,
            module_value_id: updatePayload.promoted_from_module_value_id,
            target_table: table,
            target_row_id: String(existing.id),
            action: "update",
            before_value: beforeValue,
            after_value: updatePayload,
          });
        }
      }

      return { data: { created, updated, noop }, error: null };
    } catch (error) {
      this.tables[table] = snapshot;
      this.tables.facility_launch_promotion_run_links = linksSnapshot;
      this.counters[table] = tableCounter;
      this.counters.facility_launch_promotion_run_links = linkCounter;
      return { data: null, error: { message: String(error) } };
    }
  }

  select(table: string): Row[] {
    return this.tables[table] ?? [];
  }

  insert(table: string, row: Row): Row {
    const next = { ...row };
    if (!next.id) {
      this.counters[table] = (this.counters[table] ?? 0) + 1;
      next.id = `${table}-${this.counters[table]}`;
    }
    this.tables[table].push(next);
    return next;
  }
}

function mv(module_code: string, field_path: string, value: unknown): Row {
  return {
    id: `${module_code}-${field_path}`.replace(/[^a-zA-Z0-9_-]/g, "-"),
    organization_id: ORG_ID,
    facility_id: FACILITY_ID,
    module_code,
    field_path,
    value,
    deleted_at: null,
    superseded_at: null,
  };
}

function request(modules: string[], dryRun = false) {
  return new Request("http://localhost/facility-launch-promote", {
    method: "POST",
    headers: {
      Authorization: "Bearer valid",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      facility_id: FACILITY_ID,
      modules,
      dry_run: dryRun,
    }),
  });
}

function handler(admin: FakeAdminClient) {
  return createHandler({
    createAdminClient: () => admin as never,
    now: () => new Date("2026-05-14T12:00:00.000Z"),
  });
}

async function apply(
  admin: FakeAdminClient,
  modules: string[],
  dryRun = false,
) {
  const response = await handler(admin)(request(modules, dryRun));
  const body = await response.json();
  assertEquals(response.status, 200, JSON.stringify(body));
  return body;
}

const scalarRows = [
  mv(
    "M6",
    "billingSystemSource",
    "Historical Homewood A/R workbook summaries; current 2026 A/R pending.",
  ),
  mv("M6", "billingCycle", "Monthly."),
  mv("M6", "rateApprovalOwner", "CFO / Business Office"),
  mv("M6", "postedPrivateRoomRate", "5550"),
  mv("M6", "postedCompanionRoomRate", "4000"),
  mv(
    "M6",
    "medicaidProviderRule",
    "Provider details pending current source files.",
  ),
  mv(
    "M10",
    "medicationScope",
    "QuickMar remains active; Haven imports one daily export through n8n.",
  ),
  mv("M10", "marSource", "QuickMar daily export folder."),
  mv("M10", "medicationOwner", "Administrator / Assistant / DON"),
  mv(
    "M11",
    "mealSchedule",
    "Breakfast/lunch/dinner logs found; exact times require confirmation.",
  ),
  mv("M11", "dietarySource", "Food service logs and dietary summaries."),
  mv("M11", "diningOwner", "Dining Manager / Facility staff"),
  mv(
    "M13",
    "workOrderSource",
    "Reactive work orders plus maintenance/vendor source artifacts.",
  ),
  mv(
    "M13",
    "preventiveMaintenanceCadence",
    "Inspection cadence pending workbook.",
  ),
  mv("M13", "maintenanceOwner", "Maintenance Director"),
  mv(
    "M14",
    "crmSource",
    "Admin Log and LMH Admin Manager new-admit checklist references.",
  ),
  mv(
    "M14",
    "moveInChecklistOwner",
    "Sales / Admissions Director + Business Office",
  ),
  mv(
    "M14",
    "admissionApprovalRule",
    "Use imported checklist definitions; active prospects pending.",
  ),
  mv("M19", "executiveDashboardAudience", "CEO, CFO, COO, ED, DON"),
  mv("M19", "reportCadence", "Daily 9am huddle for first 30 days"),
  mv("M19", "kpiOwner", "COO"),
];

const incidentRows = [
  mv(
    "M16",
    "incidentPolicySource",
    "Incident/grievance PDF forms and procedure templates found locally.",
  ),
  mv(
    "M16",
    "claimsRoutingOwner",
    "ED / DON / CFO — final owner requires confirmation.",
  ),
  mv(
    "M16",
    "stateReportingRule",
    "ED/DON review state-reporting threshold for major/critical events.",
  ),
  mv("M16", "incidentWorkflows", [
    {
      id: "incident-template-medication-incident-report-pdf",
      incidentType: "Medication Incident Report",
      severityRule: "Needs policy review before go-live",
      immediateActions: "Use imported incident/grievance form template.",
      familyNotificationRule: "Maybe — ED/DON decide within 24 hours",
      stateReportingThreshold: "Maybe — ED/DON decide within 24 hours",
      claimsRouting: "ED/DON review first, then decide",
      investigationOwner: "DON + ED jointly",
      followUpCadence: "Event-specific",
    },
    {
      id: "incident-template-elopement-incident-form-pdf",
      incidentType: "Elopement Incident Form",
      severityRule: "Needs policy review before go-live",
      immediateActions: "Use imported elopement incident form template.",
      familyNotificationRule: "Maybe — ED/DON decide within 24 hours",
      stateReportingThreshold: "Maybe — ED/DON decide within 24 hours",
      claimsRouting: "ED/DON review first, then decide",
      investigationOwner: "DON + ED jointly",
      followUpCadence: "Event-specific",
    },
  ]),
];

const vendorRows = [
  mv(
    "M18",
    "vendorSource",
    "Maintenance Contact List PDF plus Homewood contract PDFs.",
  ),
  mv(
    "M18",
    "afterHoursVendorRule",
    "After-hours dispatch rules pending extraction.",
  ),
  mv("M18", "vendorOwner", "Maintenance Director / Business Office"),
  mv("M18", "vendorContacts", [
    {
      id: "vendor-contact-directory-summary",
      organization: "Maintenance Contact List",
      category: "Other",
      primaryContact: "Directory summary — extract named contacts in Round 2",
      phone: "25 phone entries detected",
      afterHoursPhone: "Pending contact-level extraction",
      accountNumber: "N/A — directory summary",
      contractStatus: "Unknown",
      insuranceRequired: "Unknown",
      escalationOwner: "Maintenance Director / Business Office",
    },
  ]),
];

Deno.test("round2 scalar config modules promote source-backed settings", async () => {
  const admin = new FakeAdminClient(scalarRows);
  const body = await apply(admin, ["M6", "M10", "M11", "M13", "M14", "M19"]);

  assertEquals(body.modules_promoted.length, 6);
  assertEquals(admin.select("facility_billing_config").length, 6);
  assertEquals(admin.select("rate_schedule_versions").length, 2);
  assertEquals(admin.select("facility_medication_config").length, 3);
  assertEquals(admin.select("facility_dining_config").length, 3);
  assertEquals(admin.select("facility_maintenance_config").length, 3);
  assertEquals(admin.select("facility_admissions_config").length, 3);
  assertEquals(admin.select("facility_launch_scoreboard_config").length, 3);
  assertEquals(
    admin.select("facility_billing_config").find((row) =>
      row.field_path === "rateApprovalOwner"
    )?.value,
    "CFO / Business Office",
  );
  assertEquals(
    admin.select("rate_schedule_versions").find((row) =>
      row.rate_type === "private_room"
    )?.amount_cents,
    555000,
  );
  assertEquals(
    admin.select("rate_schedule_versions").find((row) =>
      row.rate_type === "semi_private_room"
    )?.amount_cents,
    400000,
  );
  assertEquals(
    admin.select("rate_schedule_versions").every((row) =>
      row.rate_confirmed === true
    ),
    true,
  );
});

Deno.test("m16 promotes incident config and workflow templates", async () => {
  const admin = new FakeAdminClient(incidentRows);
  const body = await apply(admin, ["M16"]);

  assertEquals(body.modules_promoted[0].status, "promoted");
  assertEquals(admin.select("facility_incident_config").length, 3);
  assertEquals(admin.select("incident_workflow_templates").length, 2);
  assertEquals(
    admin.select("incident_workflow_templates")[0].incident_type,
    "Medication Incident Report",
  );
});

Deno.test("m18 promotes vendor config and directory summaries", async () => {
  const admin = new FakeAdminClient(vendorRows);
  const body = await apply(admin, ["M18"]);

  assertEquals(body.modules_promoted[0].status, "promoted");
  assertEquals(admin.select("facility_vendor_config").length, 3);
  assertEquals(admin.select("facility_vendors").length, 1);
  assertEquals(
    admin.select("facility_vendors")[0].organization,
    "Maintenance Contact List",
  );
});

Deno.test("round2 dry-run writes no target rows or promotion runs", async () => {
  const admin = new FakeAdminClient([
    ...scalarRows,
    ...incidentRows,
    ...vendorRows,
  ]);
  const body = await apply(admin, ["M6", "M16", "M18"], true);

  assertEquals(body.run_id, null);
  assert(body.modules_promoted[0].summary.includes("would promote"));
  assertEquals(admin.select("facility_launch_promotion_runs").length, 0);
  assertEquals(admin.select("facility_billing_config").length, 0);
  assertEquals(admin.select("facility_incident_config").length, 0);
  assertEquals(admin.select("incident_workflow_templates").length, 0);
  assertEquals(admin.select("facility_vendors").length, 0);
});

Deno.test("m18 keeps same-organization vendor contacts distinct by source id", async () => {
  const admin = new FakeAdminClient([
    mv("M18", "vendorContacts", [
      {
        id: "vendor-fire-main",
        organization: "Acme Services",
        category: "Fire",
        phone: "386-555-0101",
      },
      {
        id: "vendor-fire-after-hours",
        organization: "Acme Services",
        category: "Fire",
        phone: "386-555-0199",
      },
    ]),
  ]);

  await apply(admin, ["M18"]);

  assertEquals(admin.select("facility_vendors").length, 2);
});

Deno.test("round2 collection warnings mark a module partial even when config writes", async () => {
  const admin = new FakeAdminClient([
    mv("M18", "vendorSource", "Maintenance Contact List"),
    mv("M18", "vendorContacts", [{ category: "Unknown" }]),
  ]);

  const body = await apply(admin, ["M18"]);

  assertEquals(body.modules_promoted[0].status, "partial");
  assert(body.modules_promoted[0].warnings[0].includes("missing natural key"));
  assertEquals(admin.select("facility_vendor_config").length, 1);
  assertEquals(admin.select("facility_vendors").length, 0);
});

Deno.test("round2 promoters are idempotent and do not create links on no-op rerun", async () => {
  const admin = new FakeAdminClient([...incidentRows, ...vendorRows]);
  await apply(admin, ["M16", "M18"]);
  const linkCount = admin.select("facility_launch_promotion_run_links").length;
  const incidentConfigCount = admin.select("facility_incident_config").length;
  const workflowCount = admin.select("incident_workflow_templates").length;
  const vendorConfigCount = admin.select("facility_vendor_config").length;
  const vendorCount = admin.select("facility_vendors").length;

  const second = await apply(admin, ["M16", "M18"]);

  assert(second.summary.includes("Apply recorded"));
  assertEquals(
    admin.select("facility_launch_promotion_run_links").length,
    linkCount,
  );
  assertEquals(
    admin.select("facility_incident_config").length,
    incidentConfigCount,
  );
  assertEquals(
    admin.select("incident_workflow_templates").length,
    workflowCount,
  );
  assertEquals(
    admin.select("facility_vendor_config").length,
    vendorConfigCount,
  );
  assertEquals(admin.select("facility_vendors").length, vendorCount);
});

Deno.test("round2 scalar config apply uses bounded rpc calls", async () => {
  const admin = new FakeAdminClient(scalarRows);

  await apply(admin, ["M6", "M10", "M11", "M13", "M14", "M19"]);

  const scalarRpcCalls = admin.rpcCalls.filter((call) =>
    call.fn === "promote_facility_launch_scalar_config"
  );
  assertEquals(scalarRpcCalls.length, 6);
  assertEquals(admin.queryCount("facility_billing_config", "select"), 0);
  assertEquals(admin.queryCount("facility_medication_config", "select"), 0);
  assertEquals(admin.queryCount("facility_dining_config", "select"), 0);
  assertEquals(admin.queryCount("facility_maintenance_config", "select"), 0);
  assertEquals(admin.queryCount("facility_admissions_config", "select"), 0);
  assertEquals(admin.queryCount("facility_launch_scoreboard_config", "select"), 0);
});

Deno.test("round2 dry-run does not call scalar config rpc", async () => {
  const admin = new FakeAdminClient(scalarRows);

  await apply(admin, ["M6", "M10", "M11", "M13", "M14", "M19"], true);

  const scalarRpcCalls = admin.rpcCalls.filter((call) =>
    call.fn === "promote_facility_launch_scalar_config"
  );
  assertEquals(scalarRpcCalls.length, 0);
});

Deno.test("round2 scalar config rpc failure writes no config rows/links", async () => {
  const admin = new FakeAdminClient(scalarRows);
  admin.failScalarRpcAfterFirstWrite = true;

  const response = await handler(admin)(request(["M6"]));
  const body = await response.json();

  assertEquals(response.status, 200);
  assertEquals(body.modules_promoted[0].status, "failed");
  assert(String(body.modules_promoted[0].errors[0] ?? "").includes("scalar RPC failed"));
  assertEquals(admin.select("facility_billing_config").length, 0);
  assertEquals(admin.select("facility_launch_promotion_run_links").length, 0);
});
