import { describe, expect, it } from "vitest";

import { fetchRentRollFromSupabase, rentRollRoomLabel } from "./load-rent-roll";

type Call = { table: string; op: string; args: unknown[] };

/**
 * A chainable stub that records every filter per table and resolves the
 * fixture for that table. Mirrors load-invoices.test.ts.
 */
function makeSupabaseStub(fixtures: Record<string, unknown[] | { error: string }>, calls: Call[]) {
  return {
    from(table: string) {
      const record = (op: string, ...args: unknown[]) => calls.push({ table, op, args });
      const query = {
        select(...args: unknown[]) {
          record("select", ...args);
          return query;
        },
        eq(...args: unknown[]) {
          record("eq", ...args);
          return query;
        },
        is(...args: unknown[]) {
          record("is", ...args);
          return query;
        },
        in(...args: unknown[]) {
          record("in", ...args);
          return query;
        },
        gte(...args: unknown[]) {
          record("gte", ...args);
          return query;
        },
        lte(...args: unknown[]) {
          record("lte", ...args);
          return query;
        },
        lt(...args: unknown[]) {
          record("lt", ...args);
          return query;
        },
        or(...args: unknown[]) {
          record("or", ...args);
          return query;
        },
        order(...args: unknown[]) {
          record("order", ...args);
          return query;
        },
        limit(...args: unknown[]) {
          record("limit", ...args);
          return query;
        },
        then(resolve: (value: { data: unknown[] | null; error: { message: string } | null }) => unknown) {
          const fixture = fixtures[table];
          const result =
            fixture && !Array.isArray(fixture)
              ? { data: null, error: { message: fixture.error } }
              : { data: (fixture as unknown[] | undefined) ?? [], error: null };
          return Promise.resolve(result).then(resolve);
        },
      };
      return query;
    },
  };
}

const HOMEWOOD = "00000000-0000-0000-0002-000000000003";
const SEPT = { year: 2026, month: 9 };

const bakerRow = {
  id: "res-baker",
  first_name: "Jimmie",
  last_name: "Baker",
  status: "active",
  admission_date: "2021-06-23",
  discharge_date: null,
  admission_source: "Bedrock of Live Oak Fl",
  monthly_total_rate: 300900,
  deleted_at: null,
  bed_by_id: { id: "bed-7b", bed_label: "B", rooms: { room_number: "7" } },
  beds: null,
};

describe("rentRollRoomLabel", () => {
  it("writes room then bed the way the roster does, and falls back to the reverse bed pointer", () => {
    expect(rentRollRoomLabel(bakerRow)).toEqual({ room: "7-B", bed: "B" });
    expect(rentRollRoomLabel({ bed_by_id: null, beds: [{ id: "b", bed_label: null, rooms: [{ room_number: "11" }] }] })).toEqual({ room: "11", bed: null });
    expect(rentRollRoomLabel({ bed_by_id: null, beds: null })).toEqual({ room: null, bed: null });
    expect(rentRollRoomLabel({ bed_by_id: { id: "b", bed_label: "N101-A", rooms: { room_number: "N101" } }, beds: null })).toEqual({ room: "N101-A", bed: "N101-A" });
  });
});

describe("fetchRentRollFromSupabase", () => {
  it("refuses an org-wide scope: the rent roll is per facility", async () => {
    const calls: Call[] = [];
    const stub = makeSupabaseStub({}, calls);
    await expect(fetchRentRollFromSupabase(null, SEPT, stub as never)).rejects.toThrow(/per facility/);
    expect(calls).toHaveLength(0);
  });

  it("scopes every read to the facility, the month and live rows, and assembles the sheet", async () => {
    const calls: Call[] = [];
    const stub = makeSupabaseStub(
      {
        residents: [bakerRow],
        resident_payers: [
          {
            resident_id: "res-baker",
            payer_type: "medicaid_oss",
            payer_name: "UHC",
            payer_share_type: "fixed_amount",
            payer_fixed_amount: 300900,
            medicaid_rate: 160000,
            medicaid_rate_unit: "monthly",
            medicaid_patient_responsibility: 140900,
            effective_date: "2026-05-01",
            end_date: null,
            facility_medicaid_providers: { provider_name: "United Healthcare" },
          },
        ],
        payments: [
          {
            resident_id: "res-baker",
            amount: 140900,
            payment_date: "2026-09-04",
            payment_method: "check",
            payer_type: "private_pay",
            refunded: false,
            refund_amount: null,
          },
        ],
        invoices: [
          { resident_id: "res-baker", status: "draft", total: 300900, balance_due: 300900, invoice_date: "2026-09-01", period_start: "2026-09-01" },
        ],
        collection_activities: [
          {
            resident_id: "res-baker",
            activity_date: "2026-09-08",
            activity_type: "phone_call",
            description: "Spoke with daughter",
            outcome: "Promised the 15th",
            follow_up_date: "2026-09-16",
          },
        ],
        facility_medicaid_providers: [{ provider_name: "United Healthcare", default_rate_cents: 160000, rate_unit: "monthly" }],
      },
      calls,
    );

    const { roll, planRates } = await fetchRentRollFromSupabase(HOMEWOOD, SEPT, stub as never);

    expect(roll.rows).toHaveLength(1);
    expect(roll.rows[0]).toMatchObject({
      residentName: "Baker, Jimmie",
      roomLabel: "7-B",
      admittedFrom: "Bedrock of Live Oak Fl",
      contractedCents: 300900,
      privateShareCents: 140900,
      medicaidBilledCents: 160000,
      paidPrivatelyCents: 140900,
      medicaidPaidCents: 0,
      outstandingCents: 160000,
      medicaidPlan: "United Healthcare",
      invoice: { status: "draft" },
      collectionNote: { date: "2026-09-08", text: "Spoke with daughter — Promised the 15th", followUpDate: "2026-09-16" },
    });
    expect(planRates).toEqual([{ name: "United Healthcare", rateCents: 160000, rateUnit: "monthly" }]);

    const tables = new Set(calls.map((c) => c.table));
    expect([...tables].sort()).toEqual(
      ["collection_activities", "facility_medicaid_providers", "invoices", "payments", "resident_payers", "residents"].sort(),
    );
    for (const table of tables) {
      const scoped = calls.some((c) => c.table === table && c.op === "eq" && c.args[0] === "facility_id" && c.args[1] === HOMEWOOD);
      const live = calls.some((c) => c.table === table && c.op === "is" && c.args[0] === "deleted_at" && c.args[1] === null);
      const bounded = calls.some((c) => c.table === table && c.op === "limit");
      expect({ table, scoped, live, bounded }).toEqual({ table, scoped: true, live: true, bounded: true });
    }
    expect(calls).toContainEqual({ table: "payments", op: "gte", args: ["payment_date", "2026-09-01"] });
    expect(calls).toContainEqual({ table: "payments", op: "lt", args: ["payment_date", "2026-10-01"] });
    expect(calls).toContainEqual({ table: "residents", op: "gte", args: ["discharge_date", "2026-09-01"] });
    expect(calls).toContainEqual({ table: "resident_payers", op: "lte", args: ["effective_date", "2026-09-30"] });
    expect(calls).toContainEqual({ table: "resident_payers", op: "or", args: ["end_date.is.null,end_date.gte.2026-09-01"] });
  });

  it("does not list a resident twice when they appear in both the in-building and left-this-month reads", async () => {
    const calls: Call[] = [];
    const stub = makeSupabaseStub({ residents: [bakerRow, bakerRow] }, calls);
    const { roll } = await fetchRentRollFromSupabase(HOMEWOOD, SEPT, stub as never);
    expect(roll.rows).toHaveLength(1);
  });

  it("surfaces a failed read by table name rather than an empty sheet", async () => {
    const calls: Call[] = [];
    const stub = makeSupabaseStub({ residents: [bakerRow], payments: { error: "permission denied" } }, calls);
    await expect(fetchRentRollFromSupabase(HOMEWOOD, SEPT, stub as never)).rejects.toThrow("payments: permission denied");
  });
});
