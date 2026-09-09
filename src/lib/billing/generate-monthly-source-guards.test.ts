import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import * as appProducer from "./generate-monthly-invoices";

const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");

const facilityId = "11111111-1111-4111-8111-111111111111";
const organizationId = "22222222-2222-4222-8222-222222222222";
const root = process.cwd();
const edgeFile = path.join(root, "supabase/functions/_shared/billing/generate-monthly-invoices.ts");
const handlerFile = path.join(root, "supabase/functions/generate-monthly-invoices/index.ts");
type Row = Record<string, unknown>;
type ResultOverride = { data?: unknown; count?: number | null; error?: { message: string } | null };

function fixture() {
  const common = { facility_id: facilityId, organization_id: organizationId, deleted_at: null };
  const resident = { ...common, first_name: "Synthetic", last_name: "Resident", admission_date: "2025-01-01", discharge_date: null, status: "active" };
  const rate = { ...common, end_date: null, base_rate_private: 310000, base_rate_semi_private: 248000, care_surcharge_level_1: 31000, care_surcharge_level_2: 62000, care_surcharge_level_3: 0 };
  return {
    residents: [
      { ...resident, id: "hold", acuity_level: "level_2", status: "hospital_hold" },
      { ...resident, id: "agreement", acuity_level: "level_1", admission_date: "2026-05-16" },
      { ...resident, id: "medicaid", acuity_level: "level_1", discharge_date: "2026-05-10" },
    ],
    rate_schedules: [
      { ...rate, id: "draft", status: "draft", effective_date: "2026-05-01", created_at: "2026-05-01", base_rate_private: 999000 },
      { ...rate, id: "published", status: "published", effective_date: "2026-04-01", created_at: "2026-04-01" },
    ],
    resident_payers: [{ ...common, resident_id: "medicaid", payer_type: "medicaid_oss", payer_name: "Synthetic payer", facility_medicaid_provider_id: "provider", medicaid_rate: null, is_primary: true, end_date: null }],
    facility_medicaid_providers: [{ ...common, id: "provider", active: true, default_rate_cents: 12000, rate_unit: "daily", provider_name: "Synthetic provider" }],
    resident_rate_agreements: [{ ...common, id: "agreement-1", resident_id: "agreement", status: "active", room_class: "companion", negotiated_base_rate: 217000, negotiated_care_surcharge: 15500, negotiated_monthly_total: 232500, care_charge_mode: "flat", concession_reason: "family_discount", effective_date: "2026-01-01", created_at: "2026-01-01", end_date: null }],
    invoices: [],
    facilities: [{ id: facilityId, organization_id: organizationId, status: "active", deleted_at: null, name: "Synthetic facility" }],
  } satisfies Record<string, Row[]>;
}

function clientFor(overrides: Record<string, ResultOverride> = {}, input: Record<string, Row[]> = fixture()) {
  const queries: { table: string; count?: string; limit?: number }[] = [];
  const rpc = vi.fn<(name: string, parameters: Record<string, unknown>) => Promise<{ data: { invoice_id: string | null; inserted: boolean }[] | null; error: { message: string; code?: string } | null }>>()
    .mockResolvedValue({ data: [{ invoice_id: "synthetic-invoice", inserted: true }], error: null });
  const from = vi.fn((table: string) => {
    let rows = [...(input[table] ?? [])];
    const queryInfo: (typeof queries)[number] = { table };
    queries.push(queryInfo);
    const orders: { field: string; ascending: boolean }[] = [];
    const query = {
      select(_columns: string, options?: { count?: string }) { queryInfo.count = options?.count; return this; },
      eq(field: string, value: unknown) { rows = rows.filter(row => row[field] === value); return this; },
      is(field: string, value: unknown) { rows = rows.filter(row => row[field] === value); return this; },
      in(field: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[field])); return this; },
      lte(field: string, value: string) { rows = rows.filter(row => String(row[field]) <= value); return this; },
      or(expression: string) {
        const match = /^end_date\.is\.null,end_date\.gte\.(.*)$/.exec(expression);
        if (!match) throw new Error(`Unexpected fixture OR: ${expression}`);
        rows = rows.filter(row => row.end_date === null || String(row.end_date) >= match[1]);
        return this;
      },
      order(field: string, options: { ascending: boolean }) { orders.push({ field, ...options }); return this; },
      limit(value: number) { queryInfo.limit = value; return this; },
      then(resolve: (result: unknown) => unknown, reject?: (reason: unknown) => unknown) {
        rows.sort((a, b) => {
          for (const order of orders) {
            const compared = String(a[order.field]).localeCompare(String(b[order.field]));
            if (compared) return order.ascending ? compared : -compared;
          }
          return 0;
        });
        const result = { data: rows.slice(0, queryInfo.limit), error: null,
          ...(queryInfo.count === "exact" ? { count: rows.length } : {}), ...overrides[table] };
        return Promise.resolve(result).then(resolve, reject);
      },
    };
    return query;
  });
  return { from, rpc, queries };
}

type EdgeRegistration = { handler?: (request: Request) => Promise<Response>; logs?: unknown[][] };

/** Executes exact Edge modules, replacing only its external client factory/runtime. */
function loadEdge(file: string, client?: ReturnType<typeof clientFor>, registration: EdgeRegistration = {}): unknown {
  const exports = {};
  const evaluatedModule = { exports };
  const compiled = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(compiled, {
    module: evaluatedModule, exports, Request, Response, Date, Intl, Map, Set,
    console: { log: (...values: unknown[]) => registration.logs?.push(values), error: (...values: unknown[]) => registration.logs?.push(values) },
    Deno: {
      env: { get(key: string) { return ({ GENERATE_MONTHLY_INVOICES_SECRET: "synthetic-local-secret", SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "synthetic-no-real-key" } as Record<string, string>)[key]; } },
      serve(handler: (request: Request) => Promise<Response>) { registration.handler = handler; },
    },
    require(name: string): unknown {
      if (name === "https://esm.sh/@supabase/supabase-js@2.49.1") return { createClient: () => client };
      if (name.startsWith(".")) return loadEdge(path.resolve(path.dirname(file), name), client, registration);
      throw new Error(`Unexpected Edge import: ${name}`);
    },
  }, { filename: file });
  return evaluatedModule.exports;
}
const edgeProducer = loadEdge(edgeFile) as typeof appProducer;
const period = { facilityId, billingYear: 2026, billingMonth: 5 };
const completeTables = ["residents", "resident_payers", "facility_medicaid_providers", "resident_rate_agreements", "invoices"];

for (const [name, producer] of [["app", appProducer], ["Edge shared", edgeProducer]] as const) {
  describe(`F06 ${name} complete billing sources`, () => {
    it.each(["published", "superseded"])("uses period-applicable %s rates and preserves independent charge fixtures", async (status) => {
      const input = fixture();
      input.rate_schedules[1].status = status;
      const client = clientFor({}, input);
      const result = await producer.buildMonthlyInvoicePreview(client as never, period);
      expect(result.error).toBeNull();
      // Independent arithmetic: hold310000+62000; agreement16days*(7000+500);
      // Medicaid10days*12000. Agreement standard16days*9000, concession24000.
      expect(result.preview.map(row => ({ id: row.residentId, total: row.total, concession: row.concessionAmount }))).toEqual([
        { id: "hold", total: 372000, concession: 0 },
        { id: "agreement", total: 120000, concession: 24000 },
        { id: "medicaid", total: 120000, concession: 0 },
      ]);
      expect(result.dueDate).toBe("2026-05-05");
      expect(client.queries.filter(query => completeTables.includes(query.table)).every(query => query.count === "exact")).toBe(true);
      expect(client.queries.find(query => query.table === "residents")?.limit).toBe(500);
      await producer.persistMonthlyInvoicesFromPreview(client as never, { ...period,
        preview: result.preview, periodStart: result.periodStart, periodEnd: result.periodEnd, dueDate: result.dueDate });
      expect(client.rpc.mock.calls.map(([, parameters]) => parameters.p_total)).toEqual([372000, 120000, 120000]);
      expect(JSON.stringify(client.rpc.mock.calls.map(([, parameters]) => parameters.p_adjustments))).toBe("[0,-24000,0]");
    });

    it("rejects a 2501-row resident source truncated by the existing 500-row cap", async () => {
      const input = fixture();
      input.residents = Array.from({ length: 2501 }, (_, index) => ({ ...input.residents[0], id: `resident-${index}` }));
      const client = clientFor({}, input);
      const result = await producer.buildMonthlyInvoicePreview(client as never, period);
      expect(result.preview).toEqual([]);
      expect(result.error).toMatch(/incomplete/i);
      expect(client.queries.find(query => query.table === "residents")?.limit).toBe(500);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it.each([
      { failure: "returned error", inserted: true }, { failure: "timeout", inserted: true },
      { failure: "missing acknowledgement", inserted: true }, { failure: "returned error", inserted: false },
    ])("retains acknowledged progress before $failure (first inserted=$inserted)", async ({ failure, inserted }) => {
      const client = clientFor();
      const preview = await producer.buildMonthlyInvoicePreview(client as never, period);
      client.rpc.mockResolvedValueOnce({ data: [{ invoice_id: "known-invoice", inserted }], error: null });
      if (failure === "timeout") client.rpc.mockRejectedValueOnce(new Error("Synthetic timeout"));
      else client.rpc.mockResolvedValueOnce({ data: null, error: failure === "returned error" ? { message: "Synthetic RPC failure", code: "P0001" } : null });
      await expect(producer.persistMonthlyInvoicesFromPreview(client as never, { ...period,
        preview: preview.preview, periodStart: preview.periodStart, periodEnd: preview.periodEnd, dueDate: preview.dueDate,
      })).rejects.toMatchObject({
        createdCount: inserted ? 1 : 0, skippedDuplicates: inserted ? 0 : 1,
        outcomeUnknown: true, unresolvedInvoiceNumber: "11111111-2026-05-agreement",
      });
      expect(client.rpc).toHaveBeenCalledTimes(2);
      expect(client.rpc.mock.calls.map(([, parameters]) => parameters.p_invoice_number)).toEqual([
        "11111111-2026-05-hold", "11111111-2026-05-agreement",
      ]);
    });

    it("keeps raw provider text and unresolved identity out of generic errors", async () => {
      const client = clientFor();
      const preview = await producer.buildMonthlyInvoicePreview(client as never, period);
      client.rpc.mockResolvedValueOnce({ data: null, error: { message: "RAW_PROVIDER_SENTINEL 11111111-2026-05-hold" } });
      const failure = await producer.persistMonthlyInvoicesFromPreview(client as never, { ...period,
        preview: preview.preview, periodStart: preview.periodStart, periodEnd: preview.periodEnd, dueDate: preview.dueDate,
      }).catch((error: unknown) => error) as { message: string; unresolvedInvoiceNumber: string };
      expect(failure.unresolvedInvoiceNumber).toBe("11111111-2026-05-hold");
      expect(failure.message).not.toContain("11111111-2026-05-hold");
      expect(failure.message).not.toContain("RAW_PROVIDER_SENTINEL");
    });

    it.each(completeTables)("blocks %s count larger than 2000 without a partial preview", async (table) => {
      const client = clientFor({ [table]: { count: 2501 } });
      const result = await producer.buildMonthlyInvoicePreview(client as never, period);
      expect(result.preview).toEqual([]);
      expect(result.error).toMatch(/incomplete/i);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it.each(completeTables.flatMap(table => [
      { table, state: "null count", override: { count: null } },
      { table, state: "missing count", override: { count: undefined } },
      { table, state: "null data", override: { data: null, count: 0 } },
    ]))("rejects $table $state", async ({ table, override }) => {
      const result = await producer.buildMonthlyInvoicePreview(clientFor({ [table]: override }) as never, period);
      expect(result.preview).toEqual([]);
      expect(result.error).toMatch(/incomplete/i);
    });

    it("keeps provider transport failure distinct from zero providers", async () => {
      const result = await producer.buildMonthlyInvoicePreview(clientFor({ facility_medicaid_providers: { data: null, count: null, error: { message: "Synthetic provider read failed" } } }) as never, period);
      expect(result.error).toBe("Synthetic provider read failed");
      expect(result.preview).toEqual([]);
    });

    it.each([0, 13, 5.5, NaN, Infinity])("rejects invalid month %s before querying", async (billingMonth) => {
      const client = clientFor();
      const result = await producer.buildMonthlyInvoicePreview(client as never, { ...period, billingMonth });
      expect(result.error).toMatch(/month/i);
      expect(client.from).not.toHaveBeenCalled();
    });

    it.each([0, 2026.5, NaN, Infinity])("rejects invalid year %s before querying", async (billingYear) => {
      const client = clientFor();
      const result = await producer.buildMonthlyInvoicePreview(client as never, { ...period, billingYear });
      expect(result.error).toMatch(/year/i);
      expect(client.from).not.toHaveBeenCalled();
    });

    it.each([{ count: 2501 }, { count: null }, { count: undefined }, { data: null, count: 0 }])("rejects incomplete organization facility response %j", async override => {
      await expect(producer.listActiveFacilitiesForOrganization(clientFor({ facilities: override }) as never, organizationId)).rejects.toThrow(/incomplete/i);
    });

    it("recognizes an exactly counted empty facility list", async () => {
      expect(await producer.listActiveFacilitiesForOrganization(clientFor({ facilities: { data: [], count: 0 } }) as never, organizationId)).toEqual([]);
    });
  });
}

async function invokeHandler(client: ReturnType<typeof clientFor>, body: unknown, logs?: unknown[][]) {
  const registered: EdgeRegistration = { logs };
  loadEdge(handlerFile, client, registered);
  if (!registered.handler) throw new Error("Actual Edge handler was not registered");
  return registered.handler(new Request("http://127.0.0.1/fixture", { method: "POST",
    headers: { "x-cron-secret": "synthetic-local-secret" }, body: JSON.stringify(body) }));
}

describe("F06 actual registered Edge billing handler", () => {
  it("executes organization success and returns max_facilities without ReferenceError", async () => {
    const client = clientFor();
    const response = await invokeHandler(client, { organization_id: organizationId, billing_year: 2026, billing_month: 5, max_facilities: 5 });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, max_facilities: 5, facility_count: 1, totals: { created: 3 } });
    expect(client.rpc).toHaveBeenCalledTimes(3);
    expect(client.rpc.mock.calls.map(([, parameters]) => parameters.p_total)).toEqual([372000, 120000, 120000]);
  });

  it.each(["facility", "organization"])("reports known progress and unresolved mutation in %s mode", async scope => {
    const client = clientFor();
    client.rpc.mockResolvedValueOnce({ data: [{ invoice_id: "known-created", inserted: true }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "Synthetic RPC failure", code: "P0001" } });
    const response = await invokeHandler(client, { [`${scope}_id`]: scope === "facility" ? facilityId : organizationId, billing_year: 2026, billing_month: 5 });
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, complete: false, partial: true, outcome_unknown: true });
    if (scope === "facility") {
      expect(response.status).toBe(500);
      expect(body).toMatchObject({ created: 1, skipped_duplicates: 0, unresolved_invoice_number: "11111111-2026-05-agreement" });
    } else {
      expect(body.totals).toMatchObject({ created: 1, skipped_duplicates: 0, outcomes_error: 1, outcomes_unknown: 1 });
      expect(body.facilities[0]).toMatchObject({ created: 1, outcome: "error", unresolved_invoice_number: "11111111-2026-05-agreement" });
    }
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it.each(["blocked", "unknown"])("reports mixed-facility known progress when the second facility is %s", async secondOutcome => {
    const input = fixture();
    const secondId = "33333333-3333-4333-8333-333333333333";
    input.facilities.push({ ...input.facilities[0], id: secondId, name: "ZZZ second facility" });
    if (secondOutcome === "unknown") {
      input.residents.push({ ...input.residents[0], id: "second-hold", facility_id: secondId });
      input.rate_schedules.push({ ...input.rate_schedules[1], id: "second-rate", facility_id: secondId });
    }
    const client = clientFor({}, input);
    if (secondOutcome === "unknown") {
      for (let index = 0; index < 3; index += 1) client.rpc.mockResolvedValueOnce({ data: [{ invoice_id: `known-${index}`, inserted: true }], error: null });
      client.rpc.mockRejectedValueOnce(new Error("Synthetic second-facility timeout"));
    }
    const response = await invokeHandler(client, { organization_id: organizationId, billing_year: 2026, billing_month: 5 });
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, complete: false, partial: true,
      outcome_unknown: secondOutcome === "unknown", totals: { created: 3 } });
    expect(body.facilities[0]).toMatchObject({ outcome: "success", complete: true, created: 3 });
    expect(body.facilities[1]).toMatchObject({ outcome: secondOutcome === "blocked" ? "blocked" : "error", created: 0 });
    expect(client.rpc).toHaveBeenCalledTimes(secondOutcome === "unknown" ? 4 : 3);
  });

  it("keeps a timed-out RPC separate from a known duplicate", async () => {
    const client = clientFor();
    client.rpc.mockResolvedValueOnce({ data: [{ invoice_id: "known-existing", inserted: false }], error: null })
      .mockRejectedValueOnce(new Error("Synthetic timeout"));
    const response = await invokeHandler(client, { facility_id: facilityId, billing_year: 2026, billing_month: 5 });
    expect(await response.json()).toMatchObject({ ok: false, created: 0, skipped_duplicates: 1, outcome_unknown: true,
      unresolved_invoice_number: "11111111-2026-05-agreement" });
    expect(client.rpc).toHaveBeenCalledTimes(2);
  });

  it("reports an intentional organization cap as incomplete without changing its processing limit", async () => {
    const input = fixture();
    input.facilities.push({ ...input.facilities[0], id: "33333333-3333-4333-8333-333333333333", name: "ZZZ second facility" });
    const client = clientFor({}, input);
    const response = await invokeHandler(client, { organization_id: organizationId, billing_year: 2026, billing_month: 5, max_facilities: 1 });
    expect(await response.json()).toMatchObject({ ok: false, complete: false, partial: true, outcome_unknown: false,
      truncated: true, facility_count: 2, facilities_processed: 1, max_facilities: 1, totals: { created: 3 } });
    expect(client.rpc).toHaveBeenCalledTimes(3);
  });

  it.each(["facility", "organization"])("reports preserved business-warning billing as partial in %s mode", async scope => {
    const client = clientFor({ facility_medicaid_providers: { data: [], count: 0 } });
    const response = await invokeHandler(client, { [`${scope}_id`]: scope === "facility" ? facilityId : organizationId, billing_year: 2026, billing_month: 5 });
    const body = await response.json();
    expect(body).toMatchObject({ ok: false, complete: false, partial: true, outcome_unknown: false });
    if (scope === "facility") expect(body.created).toBe(2);
    else expect(body.totals).toMatchObject({ created: 2, outcomes_partial: 1 });
    expect(client.rpc.mock.calls.map(([, parameters]) => parameters.p_total)).toEqual([372000, 120000]);
  });

  it("keeps unresolved identity in authorized output while sanitizing actual handler telemetry", async () => {
    const residentId = "44444444-4444-4444-8444-444444444444";
    const invoiceNumber = `11111111-2026-05-${residentId}`;
    const sentinel = "RAW_BILLING_ERROR_SENTINEL";
    const input = fixture();
    input.residents[1].id = residentId;
    input.resident_rate_agreements[0].resident_id = residentId;
    const client = clientFor({}, input);
    client.rpc.mockResolvedValueOnce({ data: [{ invoice_id: "known-created", inserted: true }], error: null })
      .mockResolvedValueOnce({ data: null, error: { message: `${sentinel} resident=${residentId} invoice=${invoiceNumber}`, code: "P0001" } });
    const logs: unknown[][] = [];
    const response = await invokeHandler(client, { organization_id: organizationId, billing_year: 2026, billing_month: 5 }, logs);
    const body = await response.json();
    expect(body.facilities[0]).toMatchObject({ created: 1, outcome_unknown: true, unresolved_invoice_number: invoiceNumber });
    const telemetry = JSON.stringify(logs);
    expect(telemetry).toContain("MONTHLY_INVOICE_OUTCOME_UNKNOWN");
    expect(telemetry).not.toContain(residentId);
    expect(telemetry).not.toContain(invoiceNumber);
    expect(telemetry).not.toContain(sentinel);
  });

  it.each(completeTables)("does not persist an incomplete %s facility preview", async table => {
    const client = clientFor({ [table]: { count: 2501 } });
    const response = await invokeHandler(client, { facility_id: facilityId, billing_year: 2026, billing_month: 5 });
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ ok: false, created: 0 });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("blocks organization work before persistence when facility listing is truncated", async () => {
    const client = clientFor({ facilities: { count: 2501 } });
    const response = await invokeHandler(client, { organization_id: organizationId, billing_year: 2026, billing_month: 5 });
    expect(response.status).toBe(500);
    expect(client.rpc).not.toHaveBeenCalled();
    expect(client.from.mock.calls.map(([table]) => table)).toEqual(["facilities"]);
  });

  it("reports blocked-only organization work as unsuccessful", async () => {
    const client = clientFor({ residents: { count: 2501 } });
    const response = await invokeHandler(client, { organization_id: organizationId, billing_year: 2026, billing_month: 5 });
    expect(await response.json()).toMatchObject({ ok: false, totals: { created: 0, outcomes_blocked: 1 } });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it.each([{ billing_year: 2026.5, billing_month: 5 }, { billing_year: 2026, billing_month: 5.5 }, { billing_year: "2026", billing_month: "5" }, { billing_year: null, billing_month: null }, null])("rejects invalid request period/body %j", async invalid => {
    const client = clientFor();
    const response = await invokeHandler(client, invalid === null ? null : { facility_id: facilityId, ...invalid });
    expect(response.status).toBe(400);
    expect(client.from).not.toHaveBeenCalled();
    expect(client.rpc).not.toHaveBeenCalled();
  });
});
