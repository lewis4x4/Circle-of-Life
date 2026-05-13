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
  assertEquals(payload.modules_promoted[0].status, "not_implemented");
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
    "not_implemented",
    "not_implemented",
  ]);
  assertEquals(admin.tables.facility_launch_promotion_runs.length, 1);
  const run = admin.tables.facility_launch_promotion_runs[0];
  assertEquals(run.status, "partial");
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
  assertEquals(admin.tables.facility_launch_promotion_run_links.length, 0);
  assertEquals(admin.tables.rooms.length, 0);
  assertEquals(admin.tables.beds.length, 0);
  assertEquals(admin.tables.facility_documents.length, 0);
});
