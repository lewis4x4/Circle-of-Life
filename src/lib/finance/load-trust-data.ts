import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type TrustEntry = {
  id: string;
  resident_id: string;
  facility_id: string;
  entry_date: string;
  entry_type: string;
  amount_cents: number;
  balance_after_cents: number;
  notes: string | null;
};

export type ResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  facility_id: string;
};

export type InvoiceMini = {
  resident_id: string;
  balance_due: number;
  status: string;
  facility_id: string;
};

export type ResidentTrustRow = {
  residentId: string;
  residentName: string;
  currentBalanceCents: number;
  openInvoiceCents: number;
  deltaCents: number;
  facilityId: string;
  lastEntryDate: string | null;
  entriesCount: number;
};

export async function loadFinanceTrustData(
  supabase: SupabaseClient<Database>,
  organizationId: string,
  facilityId: string | null,
): Promise<ResidentTrustRow[]> {
  let trustQuery = supabase
    .from("trust_account_entries")
    .select("id, resident_id, facility_id, entry_date, entry_type, amount_cents, balance_after_cents, notes")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .order("entry_date", { ascending: false })
    .limit(1000);

  let residentQuery = supabase
    .from("residents")
    .select("id, first_name, last_name, facility_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);

  let invoiceQuery = supabase
    .from("invoices" as never)
    .select("resident_id, balance_due, status, facility_id")
    .eq("organization_id", organizationId as never)
    .is("deleted_at" as never, null as never)
    .in("status" as never, ["sent", "partial", "overdue"] as never);

  if (facilityId) {
    trustQuery = trustQuery.eq("facility_id", facilityId);
    residentQuery = residentQuery.eq("facility_id", facilityId);
    invoiceQuery = invoiceQuery.eq("facility_id" as never, facilityId as never);
  }

  const [trustRes, residentRes, invoiceRes] = await Promise.all([
    trustQuery,
    residentQuery,
    invoiceQuery,
  ]);

  if (trustRes.error) throw trustRes.error;
  if (residentRes.error) throw residentRes.error;
  if (invoiceRes.error) throw invoiceRes.error;

  const trustEntries = (trustRes.data ?? []) as TrustEntry[];
  const residents = (residentRes.data ?? []) as ResidentMini[];
  const invoices = (invoiceRes.data ?? []) as unknown as InvoiceMini[];

  const residentMap = new Map(
    residents.map((resident) => [
      resident.id,
      `${resident.first_name ?? ""} ${resident.last_name ?? ""}`.trim() || resident.id,
    ]),
  );

  const latestBalance = new Map<
    string,
    { balance: number; facilityId: string; lastEntryDate: string | null; entriesCount: number }
  >();

  for (const entry of trustEntries) {
    const existing = latestBalance.get(entry.resident_id);
    if (!existing) {
      latestBalance.set(entry.resident_id, {
        balance: entry.balance_after_cents,
        facilityId: entry.facility_id,
        lastEntryDate: entry.entry_date,
        entriesCount: 1,
      });
    } else {
      existing.entriesCount += 1;
    }
  }

  const invoiceTotals = new Map<string, number>();
  for (const invoice of invoices) {
    invoiceTotals.set(
      invoice.resident_id,
      (invoiceTotals.get(invoice.resident_id) ?? 0) + Math.max(0, invoice.balance_due ?? 0),
    );
  }

  return Array.from(latestBalance.entries())
    .map(([residentId, snapshot]) => {
      const openInvoiceCents = invoiceTotals.get(residentId) ?? 0;
      return {
        residentId,
        residentName: residentMap.get(residentId) ?? residentId,
        currentBalanceCents: snapshot.balance,
        openInvoiceCents,
        deltaCents: snapshot.balance - openInvoiceCents,
        facilityId: snapshot.facilityId,
        lastEntryDate: snapshot.lastEntryDate,
        entriesCount: snapshot.entriesCount,
      };
    })
    .sort((left, right) => left.deltaCents - right.deltaCents);
}
