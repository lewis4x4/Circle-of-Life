import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHandler } from "../index.ts";

const ORG_ID = "00000000-0000-4000-8000-000000000001";
const FACILITY_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";

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
    if (result.error) return result;
    const data = Array.isArray(result.data) ? result.data[0] : result.data;
    if (!data) return { data: null, error: { message: "No rows" } };
    return { data, error: null };
  }

  async maybeSingle() {
    const result = this.execute();
    if (result.error) return result;
    const data = Array.isArray(result.data) ? result.data[0] ?? null : result.data ?? null;
    return { data, error: null };
  }

  then<TResult1 = { data: Row[]; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ) {
    return Promise.resolve(this.execute() as { data: Row[]; error: null }).then(onfulfilled, onrejected);
  }

  private execute(): { data: Row[]; error: null } {
    if (this.operation === "insert") {
      const rows = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((row) => this.db.insert(this.table, row as Row));
      return { data: rows, error: null };
    }
    if (this.operation === "update") {
      const rows = this.db.select(this.table).filter((row) => this.matches(row));
      for (const row of rows) Object.assign(row, this.payload as Row);
      return { data: rows, error: null };
    }
    return { data: this.db.select(this.table).filter((row) => this.matches(row)), error: null };
  }

  private matches(row: Row): boolean {
    return this.filters.every((filter) => {
      const actual = row[filter.column];
      if (filter.kind === "is" && filter.value === null) return actual === null || actual === undefined;
      if (filter.kind === "in") return Array.isArray(filter.value) && filter.value.includes(actual as never);
      return actual === filter.value;
    });
  }
}

class FakeAdminClient {
  public auth = {
    getUser: (token: string) => token === "valid"
      ? Promise.resolve({ data: { user: { id: USER_ID } }, error: null })
      : Promise.resolve({ data: { user: null }, error: { message: "bad token" } }),
  };
  private counters: Record<string, number> = {};
  public tables: Record<string, Row[]>;

  constructor(moduleValues: Row[], facilityPatch: Row = {}) {
    this.tables = {
      user_profiles: [{ id: USER_ID, app_role: "owner", organization_id: ORG_ID, is_active: true, deleted_at: null }],
      facilities: [{
        id: FACILITY_ID,
        organization_id: ORG_ID,
        entity_id: "entity-1",
        name: "Homewood Lodge ALF",
        license_number: null,
        timezone: "America/New_York",
        launch_profile_metadata: {},
        deleted_at: null,
        ...facilityPatch,
      }],
      organizations: [{ id: ORG_ID, name: "Circle of Life", timezone: "America/New_York", launch_profile_metadata: {}, deleted_at: null }],
      user_facility_access: [],
      facility_launch_module_values: moduleValues,
      facility_launch_promotion_runs: [],
      facility_launch_promotion_run_items: [],
      facility_launch_promotion_run_links: [],
      units: [],
      rooms: [],
      beds: [],
      facility_documents: [],
    };
  }

  from(table: string) {
    if (!this.tables[table]) this.tables[table] = [];
    return new FakeQuery(this, table);
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
    headers: { Authorization: "Bearer valid", "Content-Type": "application/json" },
    body: JSON.stringify({ facility_id: FACILITY_ID, modules, dry_run: dryRun }),
  });
}

function handler(admin: FakeAdminClient) {
  return createHandler({
    createAdminClient: () => admin as never,
    now: () => new Date("2026-05-13T17:27:00.000Z"),
  });
}

const m1Rows = [
  mv("M1", "parentLegalName", "Circle of Life Holdings LLC"),
  mv("M1", "dba", "Homewood Lodge ALF"),
  mv("M1", "operatingLlc", "Sorensen, Smith & Bay LLC"),
  mv("M1", "propertyLlc", "Homewood Property Company LLC"),
  mv("M1", "mailingAddress", "430 SE Mills St, Mayo, FL, 32066"),
  mv("M1", "timeZone", "America/New_York"),
  mv("M1", "corporateContact", "Crystal Ducksworth"),
  mv("M1", "billingContact", "Charlene Elmore"),
  mv("M1", "legalEntities", [{ name: "Sorensen, Smith & Bay LLC", role: "operating" }]),
];

const m2Rows = [
  mv("M2", "legalName", "Sorensen, Smith & Bay LLC"),
  mv("M2", "dba", "Homewood Lodge ALF"),
  mv("M2", "facilityType", "Assisted Living Facility"),
  mv("M2", "licenseNumber", "AL12345"),
  mv("M2", "licenseState", "FL"),
  mv("M2", "licenseAgency", "AHCA"),
  mv("M2", "licenseExpiration", "2026-12-31"),
  mv("M2", "physicalAddress", "430 SE Mills St, Mayo, FL, 32066"),
  mv("M2", "facilityAddress", "430 SE Mills St, Mayo, FL, 32066"),
  mv("M2", "mailingAddress", "430 SE Mills St, Mayo, FL, 32066"),
  mv("M2", "mainPhone", "386-555-0100"),
  mv("M2", "afterHoursPhone", "386-555-0199"),
  mv("M2", "capacity", "36"),
  mv("M2", "floorsWings", "Single floor; no wings — from Homewood room model"),
  mv("M2", "executiveDirector", "Jackie Rameriz"),
  mv("M2", "don", "TBD DON"),
  mv("M2", "maintenanceDirector", "TBD Maintenance"),
  mv("M2", "businessOfficeManager", "Charlene Elmore"),
  mv("M2", "emergencyContact", "Jackie Rameriz"),
  mv("M2", "operatingAddressConfirmed", false),
];

function homewoodRooms(): Row[] {
  return Array.from({ length: 20 }, (_, index) => {
    const n = index + 1;
    return {
      id: `room-homewood-${n}`,
      roomNumber: String(n),
      floor: "1",
      wing: "None — single floor",
      unitType: n <= 4 ? "Private single" : "Companion double",
      bedCount: n <= 4 ? 1 : 2,
      careDesignation: "Standard facility",
      status: "active",
      name: String(n),
    };
  });
}

const m3Rows = [mv("M3", "rooms", homewoodRooms())];

function docs(): Row[] {
  return [
    ["doc-gl-cert", "HOMEWOOD GL CERT.pdf", "gl_cert", "Sorensen, Smith & Bay LLC"],
    ["doc-property-policy", "HOMEWOOD PROPERTY Policy.pdf", "property_policy", "Homewood Property Company LLC"],
    ["doc-bond-certificate", "HOMEWOOD BOND CERTIFICATE.pdf", "bond_certificate", "Sorensen, Smith & Bay LLC"],
    ["doc-loss-run", "Smith & Sorensen Loss Run.pdf", "loss_run", "Sorensen, Smith & Bay LLC"],
  ].map(([id, title, artifactType, entityAssociation]) => mv("M17", `documents.${id}`, {
    id,
    title,
    originalFilename: title,
    artifactType,
    entityAssociation,
    effectiveDate: "",
    expirationDate: "",
    term: "Current file present in Drive; term metadata pending document custodian review.",
    version: "round1-source-file",
    isSourceOfTruth: true,
    custodianApprovalStatus: "pending_review",
    confidence: "source_present",
    notes: "Imported from resolved Homewood insurance source-of-truth artifact.",
  }));
}

const m17Rows = [
  mv("M17", "reviewNotes", "Round 1 imported resolved Homewood GL/property/bond/loss-run source files."),
  ...docs(),
];

async function apply(admin: FakeAdminClient, modules: string[]) {
  const res = await handler(admin)(request(modules));
  const payload = await res.json();
  assertEquals(res.status, 200, JSON.stringify(payload));
  return payload;
}

Deno.test("m1_updates_organization", async () => {
  const admin = new FakeAdminClient(m1Rows);
  await apply(admin, ["M1"]);
  const org = admin.tables.organizations[0];
  const metadata = org.launch_profile_metadata as Row;
  assertEquals(metadata.parent_legal_name, "Circle of Life Holdings LLC");
  assertEquals(metadata.dba, "Homewood Lodge ALF");
  assertEquals(metadata.operating_llc, "Sorensen, Smith & Bay LLC");
  assertEquals(metadata.property_llc, "Homewood Property Company LLC");
});

Deno.test("m2_updates_facility_full", async () => {
  const admin = new FakeAdminClient(m2Rows);
  await apply(admin, ["M2"]);
  const facility = admin.tables.facilities[0];
  assertEquals(facility.legal_name, "Sorensen, Smith & Bay LLC");
  assertEquals(facility.dba, "Homewood Lodge ALF");
  assertEquals(facility.license_number, "AL12345");
  assertEquals(facility.license_state, "FL");
  assertEquals(facility.license_expiration, "2026-12-31");
  assertEquals(facility.executive_director_name, "Jackie Rameriz");
  assertEquals(facility.business_office_manager_name, "Charlene Elmore");
  assertEquals(facility.emergency_contact_name, "Jackie Rameriz");
  assertEquals(facility.capacity, 36);
});

Deno.test("m2_partial_safe", async () => {
  const admin = new FakeAdminClient([mv("M2", "executiveDirector", "Jackie Rameriz")], {
    executive_director_name: "Manual Override",
  });
  const payload = await apply(admin, ["M2"]);
  assertEquals(admin.tables.facilities[0].executive_director_name, "Manual Override");
  assertEquals(payload.modules_promoted[0].warnings, [
    "executive_director_name has existing value 'Manual Override'; intake value 'Jackie Rameriz' was skipped. Set force_overwrite=true to override.",
  ]);
});

Deno.test("m3_creates_units_rooms_beds", async () => {
  const admin = new FakeAdminClient(m3Rows);
  await apply(admin, ["M3"]);
  assertEquals(admin.tables.units.length, 1);
  assertEquals(admin.tables.units[0].name, "Main");
  assertEquals(admin.tables.rooms.length, 20);
  assertEquals(admin.tables.beds.length, 36);
  assertEquals(admin.tables.rooms.filter((row) => row.room_type === "private").length, 4);
  assertEquals(admin.tables.rooms.filter((row) => row.room_type === "semi_private").length, 16);
});

Deno.test("m17_registers_facility_documents", async () => {
  const admin = new FakeAdminClient(m17Rows);
  await apply(admin, ["M17"]);
  assertEquals(admin.tables.facility_documents.length, 4);
  assert(admin.tables.facility_documents.every((row) => row.pending_upload === true));
  assert(admin.tables.facility_documents.every((row) => row.is_source_of_truth === true));
  assertEquals(admin.tables.facility_documents.map((row) => row.artifact_type).sort(), [
    "bond_certificate",
    "gl_cert",
    "loss_run",
    "property_policy",
  ]);
});

Deno.test("tier1_idempotent", async () => {
  const admin = new FakeAdminClient([...m1Rows, ...m2Rows, ...m3Rows, ...m17Rows]);
  await apply(admin, ["M1", "M2", "M3", "M17"]);
  const firstCounts = {
    units: admin.tables.units.length,
    rooms: admin.tables.rooms.length,
    beds: admin.tables.beds.length,
    docs: admin.tables.facility_documents.length,
    links: admin.tables.facility_launch_promotion_run_links.length,
  };
  const second = await apply(admin, ["M1", "M2", "M3", "M17"]);
  assertEquals(admin.tables.units.length, firstCounts.units);
  assertEquals(admin.tables.rooms.length, firstCounts.rooms);
  assertEquals(admin.tables.beds.length, firstCounts.beds);
  assertEquals(admin.tables.facility_documents.length, firstCounts.docs);
  assertEquals(admin.tables.facility_launch_promotion_run_links.length, firstCounts.links);
  assert(second.modules_promoted.every((result: Row) => String(result.summary).includes("already current") || String(result.summary).includes("already current") || result.module_code === "M2"));
});

Deno.test("tier1_dry_run_writes_nothing", async () => {
  const admin = new FakeAdminClient([...m1Rows, ...m2Rows, ...m3Rows, ...m17Rows]);
  const res = await handler(admin)(request(["M1", "M2", "M3", "M17"], true));
  const payload = await res.json();
  assertEquals(res.status, 200, JSON.stringify(payload));
  assertEquals(payload.run_id, null);
  assertEquals(admin.tables.facility_launch_promotion_runs.length, 0);
  assertEquals(admin.tables.facility_launch_promotion_run_items.length, 0);
  assertEquals(admin.tables.facility_launch_promotion_run_links.length, 0);
  assertEquals(admin.tables.units.length, 0);
  assertEquals(admin.tables.rooms.length, 0);
  assertEquals(admin.tables.beds.length, 0);
  assertEquals(admin.tables.facility_documents.length, 0);
  assertEquals(admin.tables.organizations[0].launch_profile_metadata, {});
  assertEquals(admin.tables.facilities[0].legal_name, undefined);
});

Deno.test("m3_preserves_existing_bed_status", async () => {
  const admin = new FakeAdminClient([mv("M3", "rooms", [homewoodRooms()[0]])]);
  admin.tables.units.push({ id: "unit-existing", facility_id: FACILITY_ID, organization_id: ORG_ID, name: "Main", floor_number: 1, sort_order: 0, deleted_at: null });
  admin.tables.rooms.push({ id: "room-existing", facility_id: FACILITY_ID, organization_id: ORG_ID, unit_id: "unit-existing", room_number: "1", room_type: "private", max_occupancy: 1, floor_number: 1, sort_order: 0, launch_profile_metadata: { facility_launch: { source_room_id: "room-homewood-1", wing: "None — single floor", unit_type: "Private single", care_designation: "Standard facility", source_status: "active" } }, deleted_at: null });
  admin.tables.beds.push({ id: "bed-existing", room_id: "room-existing", facility_id: FACILITY_ID, organization_id: ORG_ID, bed_label: "A", bed_type: "alf_intermediate", status: "occupied", current_resident_id: "resident-1", deleted_at: null });
  await apply(admin, ["M3"]);
  assertEquals(admin.tables.beds.length, 1);
  assertEquals(admin.tables.beds[0].status, "occupied");
  assertEquals(admin.tables.beds[0].current_resident_id, "resident-1");
});

Deno.test("m17_does_not_downgrade_uploaded_document", async () => {
  const admin = new FakeAdminClient(m17Rows);
  admin.tables.facility_documents.push({
    id: "existing-doc",
    facility_id: FACILITY_ID,
    organization_id: ORG_ID,
    artifact_type: "gl_cert",
    original_filename: "HOMEWOOD GL CERT.pdf",
    document_id: "real-document-id",
    pending_upload: false,
    file_path: "real/upload/path.pdf",
    uploaded_by: "original-uploader",
    deleted_at: null,
  });
  const payload = await apply(admin, ["M17"]);
  const existing = admin.tables.facility_documents.find((row) => row.id === "existing-doc")!;
  assertEquals(existing.document_id, "real-document-id");
  assertEquals(existing.pending_upload, false);
  assertEquals(existing.file_path, "real/upload/path.pdf");
  assert(payload.modules_promoted[0].warnings.some((warning: string) => warning.includes("already has an uploaded document")));
});

Deno.test("tier1_links_written", async () => {
  const admin = new FakeAdminClient([...m1Rows, ...m2Rows, ...m3Rows, ...m17Rows]);
  await apply(admin, ["M1", "M2", "M3", "M17"]);
  const links = admin.tables.facility_launch_promotion_run_links;
  assert(links.length >= 57 + 4, `expected at least M3+M17 links, got ${links.length}`);
  assert(links.every((link) => typeof link.run_item_id === "string"));
  assert(links.every((link) => typeof link.module_value_id === "string"));
  const targets = new Set(links.map((link) => link.target_table));
  assert(targets.has("organizations"));
  assert(targets.has("facilities"));
  assert(targets.has("units"));
  assert(targets.has("rooms"));
  assert(targets.has("beds"));
  assert(targets.has("facility_documents"));
});
