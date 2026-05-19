import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { createHandler } from "../index.ts";

const ORG_X = "00000000-0000-4000-8000-000000000001";
const ORG_Y = "00000000-0000-4000-8000-000000000002";
const FACILITY_ID = "10000000-0000-4000-8000-000000000001";
const USER_ID = "20000000-0000-4000-8000-000000000001";

type Row = Record<string, unknown>;
type Filter = { kind: "eq" | "is"; column: string; value: unknown };

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
    const data = Array.isArray(result.data)
      ? result.data[0] ?? null
      : result.data ?? null;
    return { data, error: null };
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
      return actual === filter.value;
    });
  }
}

class FakeAdminClient {
  public auth = {
    getUser: (token: string) => {
      if (token !== this.token) {
        return Promise.resolve({
          data: { user: null },
          error: { message: "bad token" },
        });
      }
      return Promise.resolve({ data: { user: { id: USER_ID } }, error: null });
    },
  };

  private counters: Record<string, number> = {};
  public tables: Record<string, Row[]>;

  constructor(
    private token: string,
    options: {
      role: string;
      org?: string;
      facilityGrant?: boolean;
      moduleValues?: Row[];
    },
  ) {
    const org = options.org ?? ORG_X;
    this.tables = {
      user_profiles: [{
        id: USER_ID,
        app_role: options.role,
        organization_id: org,
        is_active: true,
        deleted_at: null,
      }],
      facilities: [{ id: FACILITY_ID, organization_id: org, deleted_at: null }],
      user_facility_access: options.facilityGrant
        ? [{
          id: "grant-1",
          user_id: USER_ID,
          facility_id: FACILITY_ID,
          organization_id: org,
          revoked_at: null,
        }]
        : [],
      facility_launch_module_values: options.moduleValues ?? [
        {
          id: "mv-1",
          organization_id: org,
          facility_id: FACILITY_ID,
          module_code: "M1",
          field_path: "company.legalName",
          value: { value: "COL" },
          deleted_at: null,
          superseded_at: null,
        },
        {
          id: "mv-2",
          organization_id: org,
          facility_id: FACILITY_ID,
          module_code: "M3",
          field_path: "rooms",
          value: [{ roomNumber: "101" }],
          deleted_at: null,
          superseded_at: null,
        },
      ],
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

  async rpc(fn: string, args: Record<string, unknown>) {
    if (fn !== "promote_facility_launch_m3") return { data: null, error: { message: `unknown rpc ${fn}` } };

    const orgId = String(args.p_organization_id);
    const facilityId = String(args.p_facility_id);
    const runItemId = String(args.p_run_item_id);
    const moduleValueId = args.p_module_value_id ? String(args.p_module_value_id) : null;
    const units = Array.isArray(args.p_units) ? args.p_units as Row[] : [];
    const rooms = Array.isArray(args.p_rooms) ? args.p_rooms as Row[] : [];
    const beds = Array.isArray(args.p_beds) ? args.p_beds as Row[] : [];

    let unitsCreated = 0;
    let unitsNoop = 0;
    let roomsCreated = 0;
    let roomsNoop = 0;
    let bedsCreated = 0;
    let bedsNoop = 0;

    for (const unit of units) {
      const existing = this.tables.units.find((row) => row.deleted_at == null && row.organization_id === orgId && row.facility_id === facilityId && row.name === unit.name);
      if (!existing) {
        const inserted = this.insert("units", { organization_id: orgId, facility_id: facilityId, name: unit.name, floor_number: unit.floor_number, sort_order: unit.sort_order });
        unitsCreated += 1;
        this.insert("facility_launch_promotion_run_links", { run_item_id: runItemId, organization_id: orgId, facility_id: facilityId, module_value_id: moduleValueId, target_table: "units", target_row_id: String(inserted.id), action: "insert", before_value: null, after_value: unit });
      } else {
        unitsNoop += 1;
      }
    }

    for (const room of rooms) {
      const existing = this.tables.rooms.find((row) => row.deleted_at == null && row.organization_id === orgId && row.facility_id === facilityId && row.room_number === room.room_number);
      const unit = this.tables.units.find((row) => row.deleted_at == null && row.organization_id === orgId && row.facility_id === facilityId && row.name === room.unit_name);
      if (!existing) {
        const inserted = this.insert("rooms", { organization_id: orgId, facility_id: facilityId, unit_id: unit?.id ?? null, room_number: room.room_number, room_type: room.room_type, max_occupancy: room.max_occupancy, floor_number: room.floor_number, sort_order: room.sort_order, launch_profile_metadata: room.launch_profile_metadata });
        roomsCreated += 1;
        this.insert("facility_launch_promotion_run_links", { run_item_id: runItemId, organization_id: orgId, facility_id: facilityId, module_value_id: moduleValueId, target_table: "rooms", target_row_id: String(inserted.id), action: "insert", before_value: null, after_value: room });
      } else {
        roomsNoop += 1;
      }
    }

    for (const bed of beds) {
      const room = this.tables.rooms.find((row) => row.deleted_at == null && row.organization_id === orgId && row.facility_id === facilityId && row.room_number === bed.room_number);
      if (!room) return { data: null, error: { message: `room missing for bed ${String(bed.room_number)}` } };
      const existing = this.tables.beds.find((row) => row.deleted_at == null && row.room_id === room.id && row.bed_label === bed.bed_label);
      if (!existing) {
        const inserted = this.insert("beds", { room_id: room.id, organization_id: orgId, facility_id: facilityId, bed_label: bed.bed_label, bed_type: bed.bed_type, status: bed.status });
        bedsCreated += 1;
        this.insert("facility_launch_promotion_run_links", { run_item_id: runItemId, organization_id: orgId, facility_id: facilityId, module_value_id: moduleValueId, target_table: "beds", target_row_id: String(inserted.id), action: "insert", before_value: null, after_value: bed });
      } else {
        bedsNoop += 1;
      }
    }

    return { data: { units_created: unitsCreated, units_noop: unitsNoop, rooms_created: roomsCreated, rooms_noop: roomsNoop, beds_created: bedsCreated, beds_noop: bedsNoop, warnings: [] }, error: null };
  }
}

function makeRequest(body: Row, token?: string) {
  return new Request("http://localhost/facility-launch-promote", {
    method: "POST",
    headers: token
      ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }
      : { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeHandler(admin: FakeAdminClient) {
  return createHandler({
    createAdminClient: () => admin as never,
    now: () => new Date("2026-05-13T17:27:00.000Z"),
  });
}

Deno.test("unauthorized_without_jwt", async () => {
  const admin = new FakeAdminClient("valid", { role: "owner" });
  const res = await makeHandler(admin)(
    makeRequest({ facility_id: FACILITY_ID }),
  );
  assertEquals(res.status, 401);
  assertEquals(admin.tables.facility_launch_promotion_runs.length, 0);
});

Deno.test("forbidden_for_caregiver_role", async () => {
  const admin = new FakeAdminClient("valid", { role: "caregiver" });
  const res = await makeHandler(admin)(
    makeRequest({ facility_id: FACILITY_ID }, "valid"),
  );
  assertEquals(res.status, 403);
  assertEquals(admin.tables.facility_launch_promotion_runs.length, 0);
});

Deno.test("cross_org_blocked", async () => {
  const admin = new FakeAdminClient("valid", { role: "owner", org: ORG_X });
  const res = await makeHandler(admin)(
    makeRequest({ organization_id: ORG_Y, facility_id: FACILITY_ID }, "valid"),
  );
  assertEquals(res.status, 403);
  assertEquals(admin.tables.facility_launch_promotion_runs.length, 0);
});

Deno.test("dry_run_writes_nothing", async () => {
  const admin = new FakeAdminClient("valid", {
    role: "facility_admin",
    facilityGrant: true,
  });
  const res = await makeHandler(admin)(
    makeRequest({
      facility_id: FACILITY_ID,
      modules: ["M1", "M2"],
      dry_run: true,
    }, "valid"),
  );
  const payload = await res.json();

  assertEquals(res.status, 200);
  assertEquals(payload.run_id, null);
  assertEquals(payload.mode, "dry_run");
  assertEquals(payload.modules_promoted.length, 1);
  assertEquals(payload.modules_promoted[0].module_code, "M1");
  assertEquals(payload.modules_promoted[0].status, "skipped");
  assertEquals(payload.gap_modules, ["M2"]);
  assertEquals(admin.tables.facility_launch_promotion_runs.length, 0);
  assertEquals(admin.tables.facility_launch_promotion_run_items.length, 0);
  assertEquals(admin.tables.rooms.length, 0);
  assertEquals(admin.tables.beds.length, 0);
});

Deno.test("omitted_dry_run_defaults_to_apply_and_writes_run_header_and_items", async () => {
  const admin = new FakeAdminClient("valid", { role: "owner" });
  const res = await makeHandler(admin)(
    makeRequest({ facility_id: FACILITY_ID }, "valid"),
  );
  const payload = await res.json();

  assertEquals(res.status, 200);
  assertEquals(payload.mode, "apply");
  assertEquals(typeof payload.run_id, "string");
  assertEquals(payload.modules_promoted.map((item: Row) => item.status), [
    "skipped",
    "promoted",
  ]);
  assertEquals(admin.tables.facility_launch_promotion_runs.length, 1);
  const run = admin.tables.facility_launch_promotion_runs[0];
  assertEquals(run.status, "succeeded");
  assertEquals(run.dry_run, false);
  assertEquals(run.triggered_by, USER_ID);
  assertEquals(run.modules_requested, []);
  assertEquals(typeof run.summary, "string");
  assertEquals((run.metadata as Row).processed_modules, ["M1", "M3"]);
  assertEquals((run.metadata as Row).gap_modules, []);
  assertEquals(Object.hasOwn(run, "source_kind"), false);
  assertEquals(Object.hasOwn(run, "mode"), false);
  assertEquals(Object.hasOwn(run, "requested_by"), false);
  assertEquals(Object.hasOwn(run, "requested_via"), false);
  assertEquals(Object.hasOwn(run, "modules_processed"), false);
  assertEquals(Object.hasOwn(run, "gap_modules"), false);
  assertEquals(Object.hasOwn(run, "options"), false);
  assertEquals(Object.hasOwn(run, "error_message"), false);

  assertEquals(admin.tables.facility_launch_promotion_run_items.length, 2);
  const item = admin.tables.facility_launch_promotion_run_items[0];
  assertEquals(Array.isArray(item.warnings), true);
  assertEquals(Array.isArray(item.errors), true);
  assertEquals(Object.hasOwn(item, "created_by"), false);
  assertEquals(Object.hasOwn(item, "deleted_at"), false);
  assertEquals(admin.tables.facility_launch_promotion_run_links.length, 3);
  assertEquals(admin.tables.rooms.length, 1);
  assertEquals(admin.tables.beds.length, 1);
  assertEquals(admin.tables.facility_documents.length, 0);
});
