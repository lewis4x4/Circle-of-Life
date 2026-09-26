import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";

import { SENT_INVOICE_POSTGREST_OR, wasInvoiceSent } from "@/lib/billing/receivables";
import type { Database } from "@/types/database";

import { fetchFamilyBillingContext } from "./family-billing-data";

const invoice = (id: string, status: string, sent_at: string | null = null) => ({
  id,
  resident_id: "resident",
  invoice_number: id,
  invoice_date: "2026-09-01",
  due_date: "2026-09-30",
  period_start: "2026-09-01",
  period_end: "2026-09-30",
  total: 100,
  balance_due: status === "paid" ? 0 : 100,
  status,
  sent_at,
});

function clientReturning(invoices: ReturnType<typeof invoice>[]) {
  const orFilters: string[] = [];
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: "family" } }, error: null }) },
    from: (table: string) => {
      const q: Record<string, ReturnType<typeof vi.fn>> = {};
      for (const method of ["select", "is", "order", "limit", "in", "eq", "lt"]) q[method] = vi.fn(() => q);
      q.or = vi.fn((filter: string) => {
        if (table === "invoices") orFilters.push(filter);
        return q;
      });
      q.then = vi.fn((resolve) =>
        resolve({
          data:
            table === "invoices"
              ? invoices
              : table === "residents"
                ? [{ id: "resident", first_name: "Test", last_name: "Resident" }]
                : table === "family_resident_links"
                  ? [{ resident_id: "resident" }]
                  : [],
          error: null,
        }),
      );
      return q;
    },
  } as unknown as SupabaseClient<Database>;
  return { client, orFilters };
}

describe("families see sent invoices only (COL-709)", () => {
  it("classifies sent statuses; a void counts only if it was sent", () => {
    for (const status of ["sent", "partial", "overdue", "paid", "written_off"]) {
      expect(wasInvoiceSent({ status })).toBe(true);
    }
    expect(wasInvoiceSent({ status: "draft" })).toBe(false);
    expect(wasInvoiceSent({ status: "void", sent_at: null })).toBe(false);
    expect(wasInvoiceSent({ status: "void", sent_at: "2026-09-02T12:00:00Z" })).toBe(true);
  });

  it("asks the database for sent invoices only", async () => {
    const { client, orFilters } = clientReturning([invoice("a", "sent")]);
    await fetchFamilyBillingContext(client);
    expect(orFilters).toEqual([SENT_INVOICE_POSTGREST_OR]);
    expect(SENT_INVOICE_POSTGREST_OR).not.toMatch(/draft/);
  });

  it("never lists a draft or an unsent void, even if the read returns one", async () => {
    const { client } = clientReturning([
      invoice("sent", "sent"),
      invoice("draft", "draft"),
      invoice("void-draft", "void"),
      invoice("paid", "paid"),
    ]);
    const result = await fetchFamilyBillingContext(client);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.invoices.map((i) => i.id).sort()).toEqual(["paid", "sent"]);
      expect(result.data.totalBalanceDue).toBe(100);
    }
  });
});
