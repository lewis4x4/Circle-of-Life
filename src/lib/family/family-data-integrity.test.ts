import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { fetchFamilyBillingContext } from "./family-billing-data";
import { fetchFamilyMessagesForResident } from "./family-messages-data";

function client(tables: Record<string, Record<string, unknown>[]>) {
  return {
    auth: { getUser: async () => ({ data: { user: { id: "family" } }, error: null }) },
    from(table: string) {
      let rows = [...(tables[table] ?? [])];
      const q = {
        select: () => q, is: () => q, in: () => q, eq: () => q,
        order: (field: string, options: { ascending: boolean }) => {
          rows.sort((a, b) => String(a[field]).localeCompare(String(b[field])) * (options.ascending ? 1 : -1));
          return q;
        },
        limit: (n: number) => { rows = rows.slice(0, n); return q; },
        range: (a: number, b: number) => { rows = rows.slice(a, b + 1); return q; },
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
      };
      return q;
    },
  } as unknown as SupabaseClient<Database>;
}

describe("family data integrity", () => {
  it("includes older unpaid invoices beyond the displayed history in the balance", async () => {
    const invoices = Array.from({ length: 61 }, (_, i) => ({
      id: String(i), resident_id: "resident", invoice_number: String(i),
      invoice_date: i === 60 ? "2020-01-01" : "2026-09-01", due_date: "2026-09-01",
      period_start: "2026-09-01", period_end: "2026-09-30", total: 12500,
      balance_due: i === 60 ? 12500 : 0, status: i === 60 ? "overdue" : "paid",
    }));
    const result = await fetchFamilyBillingContext(client({ invoices }));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.totalBalanceDue).toBe(12500);
      expect(result.data.hasOverdue).toBe(true);
    }
  });

  it("retains newest updates after the first 200 messages", async () => {
    const messages = Array.from({ length: 201 }, (_, i) => ({
      id: String(i), author_user_id: "staff", author_kind: "staff", body: `Update ${i}`,
      created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
    }));
    const result = await fetchFamilyMessagesForResident(client({ family_portal_messages: messages }), "resident");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.messages.some((m) => m.id === "200")).toBe(true);
  });
});
