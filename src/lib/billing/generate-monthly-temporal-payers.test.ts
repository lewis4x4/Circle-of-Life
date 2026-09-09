import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import * as app from "./generate-monthly-invoices";

const ts = createRequire(import.meta.url)("typescript") as typeof import("typescript");
const root = process.cwd();
const facilityId = "11111111-1111-4111-8111-111111111111";
const residentId = "44444444-4444-4444-8444-444444444444";
type Payer = { start: string | null; end: string | null; type?: string };
type Scenario = { name: string; year?: number; month?: number; admission: string | null; discharge: string | null; payers: Payer[]; cents: number | null };
const scenarios: Scenario[] = [
  { name: "future June primary leaves established May private baseline", admission: "2025-01-01", discharge: null, payers: [{ start: "2026-06-01", end: null }], cents: 372000 },
  { name: "May16 admission starts Medicaid on May16", admission: "2026-05-16", discharge: null, payers: [{ start: "2026-05-16", end: null }], cents: 51613 },
  { name: "payer end includes the official May15 discharge day", admission: "2025-01-01", discharge: "2026-05-15", payers: [{ start: "2025-01-01", end: "2026-05-15" }], cents: 48387 },
  { name: "wholly ended primary leaves established private default", admission: "2025-01-01", discharge: null, payers: [{ start: "2025-01-01", end: "2026-04-30" }], cents: 372000 },
  { name: "payer ends before resident billable end", admission: "2025-01-01", discharge: null, payers: [{ start: "2025-01-01", end: "2026-05-15" }], cents: null },
  { name: "payer starts after existing resident billable start", admission: "2025-01-01", discharge: null, payers: [{ start: "2026-05-16", end: null }], cents: null },
  { name: "mid-month responsibility change requires real split", admission: "2025-01-01", discharge: null, payers: [{ start: "2025-01-01", end: "2026-05-15", type: "private_pay" }, { start: "2026-05-16", end: null }], cents: null },
  { name: "multiple covering primaries have no arbitrary winner", admission: "2025-01-01", discharge: null, payers: [{ start: "2025-01-01", end: null }, { start: "2026-01-01", end: null }], cents: null },
  { name: "partially overlapping primaries require correction", admission: "2025-01-01", discharge: null, payers: [{ start: "2025-01-01", end: "2026-05-20" }, { start: "2026-05-16", end: null }], cents: null },
  { name: "reversed primary interval is invalid", admission: "2025-01-01", discharge: null, payers: [{ start: "2026-05-20", end: "2026-05-10" }], cents: null },
  { name: "calendar-invalid payer date is rejected", admission: "2025-01-01", discharge: null, payers: [{ start: "2026-02-30", end: null }], cents: null },
  { name: "missing primary effective date is rejected", admission: "2025-01-01", discharge: null, payers: [{ start: null, end: null }], cents: null },
  { name: "reversed resident interval is invalid", admission: "2026-05-20", discharge: "2026-05-10", payers: [], cents: null },
  { name: "unknown admission cannot establish billable dates", admission: null, discharge: null, payers: [], cents: null },
  { name: "leap February15–29 has15 billable days", year: 2024, month: 2, admission: "2024-02-15", discharge: "2024-02-29", payers: [{ start: "2024-02-15", end: "2024-02-29" }], cents: 51724 },
  { name: "spring DST March8–31 has24 civil days", month: 3, admission: "2026-03-08", discharge: null, payers: [{ start: "2026-03-08", end: null }], cents: 77419 },
  { name: "fall DST discharge November1 counts one civil day", month: 11, admission: "2026-10-15", discharge: "2026-11-01", payers: [{ start: "2026-10-15", end: "2026-11-01" }], cents: 3333 },
  { name: "future admission has no May billable days", admission: "2026-06-01", discharge: null, payers: [{ start: "2026-06-01", end: null }], cents: 0 },
  { name: "same-day admission and discharge includes one day", admission: "2026-05-16", discharge: "2026-05-16", payers: [{ start: "2026-05-16", end: "2026-05-16" }], cents: 3226 },
  { name: "no current primary retains private baseline", admission: "2025-01-01", discharge: null, payers: [], cents: 372000 },
  { name: "explicit full-May private primary beats unrelated future Medicaid", admission: "2025-01-01", discharge: null, payers: [{ start: "2025-01-01", end: "2026-05-31", type: "private_pay" }, { start: "2026-06-01", end: null }], cents: 372000 },
];

function clientFor(scenario: Scenario) {
  const common = { facility_id: facilityId, organization_id: "organization", deleted_at: null };
  const tables: Record<string, Record<string, unknown>[]> = {
    residents: [{ ...common, id: residentId, first_name: "Synthetic", last_name: "Resident", status: "active", acuity_level: "level_2", admission_date: scenario.admission, discharge_date: scenario.discharge }],
    rate_schedules: [{ ...common, id: "published-rate", status: "published", effective_date: "2020-01-01", end_date: null, base_rate_private: 310000, base_rate_semi_private: 248000, care_surcharge_level_1: 0, care_surcharge_level_2: 62000, care_surcharge_level_3: 0 }],
    resident_payers: scenario.payers.map((payer, index) => ({ ...common, id: `payer-${index}`, resident_id: residentId, is_primary: true, payer_type: payer.type ?? "medicaid_oss", payer_name: "Synthetic payer", medicaid_rate: 100000, facility_medicaid_provider_id: null, effective_date: payer.start, end_date: payer.end })),
    facility_medicaid_providers: [], resident_rate_agreements: [], invoices: [],
  };
  const rpc = vi.fn().mockResolvedValue({ data: [{ invoice_id: "known-invoice", inserted: true }], error: null });
  const from = vi.fn((table: string) => {
    let rows = [...(tables[table] ?? [])];
    let countRequested = false;
    let cap: number | undefined;
    return {
      select(_fields: string, options?: { count?: string }) { countRequested = options?.count === "exact"; return this; },
      eq(field: string, value: unknown) { rows = rows.filter(row => row[field] === value); return this; },
      is(field: string, value: unknown) { rows = rows.filter(row => row[field] === value); return this; },
      in(field: string, values: unknown[]) { rows = rows.filter(row => values.includes(row[field])); return this; },
      lte(field: string, value: string) { rows = rows.filter(row => String(row[field]) <= value); return this; },
      or(expression: string) { const end = expression.split("end_date.gte.")[1]; rows = rows.filter(row => row.end_date === null || String(row.end_date) >= end); return this; },
      order() { return this; },
      limit(value: number) { cap = value; return this; },
      then(resolve: (result: unknown) => unknown) { return Promise.resolve({ data: rows.slice(0, cap), error: null, ...(countRequested ? { count: rows.length } : {}) }).then(resolve); },
    };
  });
  return { from, rpc, tables };
}

type Registration = { handler?: (request: Request) => Promise<Response> };
function edgeModule(file: string, client?: ReturnType<typeof clientFor>, registration: Registration = {}): unknown {
  const exports = {};
  const evaluatedModule = { exports };
  const code = ts.transpileModule(fs.readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(code, {
    module: evaluatedModule, exports, Request, Response, Date, Intl, Map, Set,
    console: { log() {}, error() {} },
    Deno: { env: { get(key: string) { return ({ GENERATE_MONTHLY_INVOICES_SECRET: "synthetic-secret", SUPABASE_URL: "http://127.0.0.1:1", SUPABASE_SERVICE_ROLE_KEY: "synthetic-key" } as Record<string, string>)[key]; } }, serve(handler: Registration["handler"]) { registration.handler = handler; } },
    require(name: string): unknown {
      if (name === "https://esm.sh/@supabase/supabase-js@2.49.1") return { createClient: () => client };
      if (name.startsWith(".")) return edgeModule(path.resolve(path.dirname(file), name), client, registration);
      throw new Error(`Unexpected import: ${name}`);
    },
  }, { filename: file });
  return evaluatedModule.exports;
}
const edge = edgeModule(path.join(root, "supabase/functions/_shared/billing/generate-monthly-invoices.ts")) as typeof app;

for (const [label, producer] of [["app", app], ["Edge", edge]] as const) {
  describe(`F06 ${label} temporal payer selection`, () => {
    it.each(scenarios)("$name", async scenario => {
      const client = clientFor(scenario);
      const result = await producer.buildMonthlyInvoicePreview(client as never, { facilityId, billingYear: scenario.year ?? 2026, billingMonth: scenario.month ?? 5 });
      if (scenario.cents === null) {
        expect(result.preview).toEqual([]);
        expect(result.error).toMatch(/interval|billable|split/i);
        expect(result.error).not.toContain(residentId);
      } else {
        expect(result.error).toBeNull();
        expect(result.preview.reduce((sum, row) => sum + row.total, 0)).toBe(scenario.cents);
        if (scenario.cents === 0) expect(result.preview).toEqual([]);
      }
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it("does not choose an overlapping primary by response order", async () => {
      const scenario = scenarios.find(row => row.name.startsWith("multiple covering"))!;
      for (const payers of [scenario.payers, [...scenario.payers].reverse()]) {
        const result = await producer.buildMonthlyInvoicePreview(clientFor({ ...scenario, payers }) as never, { facilityId, billingYear: 2026, billingMonth: 5 });
        expect(result.preview).toEqual([]);
        expect(result.error).toMatch(/Multiple primary/i);
      }
    });

    it("blocks the entire preview instead of quietly skipping an ambiguous resident", async () => {
      const client = clientFor(scenarios.find(row => row.name.startsWith("mid-month"))!);
      client.tables.residents.push({ ...client.tables.residents[0], id: "otherwise-billable-private" });
      const result = await producer.buildMonthlyInvoicePreview(client as never, { facilityId, billingYear: 2026, billingMonth: 5 });
      expect(result.preview).toEqual([]);
      expect(result.error).toMatch(/Split billing/i);
    });
  });
}

it("actual Edge handler does not persist a mid-month responsibility guess", async () => {
  const client = clientFor(scenarios.find(row => row.name.startsWith("mid-month"))!);
  const registration: Registration = {};
  edgeModule(path.join(root, "supabase/functions/generate-monthly-invoices/index.ts"), client, registration);
  if (!registration.handler) throw new Error("Actual handler not registered");
  const response = await registration.handler(new Request("http://127.0.0.1/fixture", { method: "POST", headers: { "x-cron-secret": "synthetic-secret" }, body: JSON.stringify({ facility_id: facilityId, billing_year: 2026, billing_month: 5 }) }));
  expect(response.status).toBe(422);
  expect(await response.json()).toMatchObject({ ok: false, complete: false, created: 0, outcome_unknown: false });
  expect(client.rpc).not.toHaveBeenCalled();
});
