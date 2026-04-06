import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Shared monthly invoice preview + persistence for admin UI and Edge Functions.
 * Idempotent per (facility, resident, period_start) via DB unique index (migration 071).
 * Edge duplicate: `supabase/functions/_shared/billing/generate-monthly-invoices.ts`.
 */

export type QueryError = { message: string; code?: string };

export type Resident = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  acuity_level: string;
  status: string;
  admission_date: string | null;
  facility_id: string;
  organization_id: string;
};

export type RateSchedule = {
  id: string;
  base_rate_private: number;
  base_rate_semi_private: number | null;
  care_surcharge_level_1: number;
  care_surcharge_level_2: number;
  care_surcharge_level_3: number;
};

export type ResidentPayer = {
  resident_id: string;
  payer_type: string;
  payer_name: string | null;
};

export type PreviewLine = {
  residentId: string;
  residentName: string;
  payerType: string;
  payerName: string;
  baseRate: number;
  careSurcharge: number;
  total: number;
  acuity: string;
  prorated: boolean;
};

export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export function monthLabel(year: number, month: number): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

export function getNextBillingMonth(): { year: number; month: number } {
  const now = new Date();
  const day = now.getDate();
  if (day >= 25) {
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return { year: next.getFullYear(), month: next.getMonth() + 1 };
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function surchargeForAcuity(
  rate: RateSchedule,
  acuity: string,
): { cents: number; label: string } {
  switch (acuity) {
    case "level_1":
      return { cents: rate.care_surcharge_level_1, label: "Level 1" };
    case "level_2":
      return { cents: rate.care_surcharge_level_2, label: "Level 2" };
    case "level_3":
      return { cents: rate.care_surcharge_level_3, label: "Level 3" };
    default:
      return { cents: 0, label: "Unknown" };
  }
}

export type BuildPreviewResult = {
  preview: PreviewLine[];
  error: string | null;
  billingLabel: string;
  days: number;
  periodStart: string;
  periodEnd: string;
  dueDate: string;
};

export async function buildMonthlyInvoicePreview(
  supabase: SupabaseClient,
  params: {
    facilityId: string;
    billingYear: number;
    billingMonth: number;
  },
): Promise<BuildPreviewResult> {
  const { facilityId, billingYear, billingMonth } = params;
  const billingLabel = monthLabel(billingYear, billingMonth);
  const days = daysInMonth(billingYear, billingMonth);
  const periodStart = `${billingYear}-${String(billingMonth).padStart(2, "0")}-01`;
  const periodEnd = `${billingYear}-${String(billingMonth).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
  const dueDate = new Date(billingYear, billingMonth - 1, 15).toISOString().slice(0, 10);

  type QR<T> = { data: T | null; error: QueryError | null };

  const resP = supabase
    .from("residents" as never)
    .select(
      "id, first_name, last_name, acuity_level, status, admission_date, facility_id, organization_id",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "active")
    .limit(200);

  const rateP = supabase
    .from("rate_schedules" as never)
    .select(
      "id, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .is("end_date", null)
    .order("effective_date", { ascending: false })
    .limit(1);

  const payerP = supabase
    .from("resident_payers" as never)
    .select("resident_id, payer_type, payer_name")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .is("end_date", null)
    .eq("is_primary", true);

  const existingP = supabase
    .from("invoices" as never)
    .select("resident_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("period_start", periodStart)
    .limit(200);

  const [resResult, rateResult, payerResult, existingResult] =
    (await Promise.all([resP, rateP, payerP, existingP])) as unknown as [
      QR<Resident[]>,
      QR<RateSchedule[]>,
      QR<ResidentPayer[]>,
      QR<{ resident_id: string }[]>,
    ];

  if (existingResult.error) {
    return {
      preview: [],
      error: existingResult.error.message,
      billingLabel,
      days,
      periodStart,
      periodEnd,
      dueDate,
    };
  }

  if (resResult.error) {
    return {
      preview: [],
      error: resResult.error.message,
      billingLabel,
      days,
      periodStart,
      periodEnd,
      dueDate,
    };
  }
  if (rateResult.error) {
    return {
      preview: [],
      error: rateResult.error.message,
      billingLabel,
      days,
      periodStart,
      periodEnd,
      dueDate,
    };
  }
  if (payerResult.error) {
    return {
      preview: [],
      error: payerResult.error.message,
      billingLabel,
      days,
      periodStart,
      periodEnd,
      dueDate,
    };
  }

  const residents = resResult.data ?? [];
  const rate = (rateResult.data ?? [])[0];
  const payers = payerResult.data ?? [];
  const alreadyInvoiced = new Set((existingResult.data ?? []).map((r) => r.resident_id));

  if (!rate) {
    return {
      preview: [],
      error:
        "No active rate schedule found for this facility. Create one under Billing > Rates.",
      billingLabel,
      days,
      periodStart,
      periodEnd,
      dueDate,
    };
  }

  const payerMap = new Map(payers.map((p) => [p.resident_id, p]));

  const preview: PreviewLine[] = residents
    .filter((r) => !alreadyInvoiced.has(r.id))
    .map((r) => {
      const name = `${(r.last_name ?? "").trim()}, ${(r.first_name ?? "").trim()}`.replace(
        /^, |, $/,
        "",
      );
      const payer = payerMap.get(r.id);
      const baseRate = rate.base_rate_private;
      const surcharge = surchargeForAcuity(rate, r.acuity_level);

      let effectiveBase = baseRate;
      let prorated = false;
      if (r.admission_date) {
        const admDate = new Date(r.admission_date);
        const periodStartDate = new Date(billingYear, billingMonth - 1, 1);
        if (admDate > periodStartDate) {
          const daysPresent = days - admDate.getDate() + 1;
          effectiveBase = Math.round((baseRate * daysPresent) / days);
          prorated = true;
        }
      }

      return {
        residentId: r.id,
        residentName: name,
        payerType: payer?.payer_type ?? "private_pay",
        payerName: payer?.payer_name ?? "Responsible party",
        baseRate: effectiveBase,
        careSurcharge: surcharge.cents,
        total: effectiveBase + surcharge.cents,
        acuity: surcharge.label,
        prorated,
      };
    });

  let message: string | null = null;
  if (alreadyInvoiced.size > 0 && preview.length === 0 && residents.length > 0) {
    message = `All ${residents.length} residents already have invoices for ${billingLabel}. No new invoices to generate.`;
  }

  return {
    preview,
    error: message,
    billingLabel,
    days,
    periodStart,
    periodEnd,
    dueDate,
  };
}

export type PersistResult = {
  createdCount: number;
  skippedDuplicates: number;
};

export async function persistMonthlyInvoicesFromPreview(
  supabase: SupabaseClient,
  params: {
    facilityId: string;
    billingYear: number;
    billingMonth: number;
    preview: PreviewLine[];
    periodStart: string;
    periodEnd: string;
    dueDate: string;
  },
): Promise<PersistResult> {
  const { facilityId, billingYear, billingMonth, preview, periodStart, periodEnd, dueDate } =
    params;

  const facilityRow = (await supabase
    .from("facilities" as never)
    .select("entity_id")
    .eq("id", facilityId)
    .maybeSingle()) as unknown as {
    data: { entity_id: string } | null;
    error: QueryError | null;
  };
  if (facilityRow.error) throw new Error(facilityRow.error.message);
  if (!facilityRow.data) throw new Error("Facility not found.");

  const entityId = facilityRow.data.entity_id;
  const facilityCode = facilityId.replace(/-/g, "").slice(0, 8).toUpperCase();

  let createdCount = 0;
  let skippedDuplicates = 0;

  const ym = `${billingYear}-${String(billingMonth).padStart(2, "0")}`;
  for (let i = 0; i < preview.length; i++) {
    const line = preview[i];
    // Stable per resident+month (not preview index) so retries/idempotent runs do not collide on idx_invoices_number.
    const invoiceNumber = `${facilityCode}-${ym}-${line.residentId}`;

    const resRow = (await supabase
      .from("residents" as never)
      .select("organization_id")
      .eq("id", line.residentId)
      .maybeSingle()) as {
      data: { organization_id: string } | null;
      error: QueryError | null;
    };
    if (resRow.error) throw new Error(resRow.error.message);
    const orgId = resRow.data?.organization_id;
    if (!orgId) continue;

    const { data: invData, error: invErr } = (await supabase
      .from("invoices" as never)
      .insert({
        resident_id: line.residentId,
        facility_id: facilityId,
        organization_id: orgId,
        entity_id: entityId,
        invoice_number: invoiceNumber,
        invoice_date: periodStart,
        due_date: dueDate,
        period_start: periodStart,
        period_end: periodEnd,
        status: "draft",
        subtotal: line.total,
        adjustments: 0,
        tax: 0,
        total: line.total,
        amount_paid: 0,
        balance_due: line.total,
        payer_type: line.payerType,
        payer_name: line.payerName,
      } as never)
      .select("id")
      .single()) as {
      data: { id: string } | null;
      error: QueryError | null;
    };

    if (invErr) {
      if (invErr.code === "23505") {
        skippedDuplicates += 1;
        continue;
      }
      throw new Error(invErr.message);
    }
    if (!invData) continue;

    const lineItems = [
      {
        invoice_id: invData.id,
        organization_id: orgId,
        line_type: "room_and_board",
        description: line.prorated
          ? `Private Room — Prorated (${monthLabel(billingYear, billingMonth)})`
          : `Private Room — Monthly Rate`,
        quantity: 1,
        unit_price: line.baseRate,
        total: line.baseRate,
        sort_order: 1,
      },
    ];

    if (line.careSurcharge > 0) {
      lineItems.push({
        invoice_id: invData.id,
        organization_id: orgId,
        line_type: "care_surcharge",
        description: `${line.acuity} Care Surcharge`,
        quantity: 1,
        unit_price: line.careSurcharge,
        total: line.careSurcharge,
        sort_order: 2,
      });
    }

    const liErr = await supabase.from("invoice_line_items" as never).insert(lineItems as never);
    if (liErr.error) throw new Error(liErr.error.message);

    createdCount += 1;
  }

  return { createdCount, skippedDuplicates };
}

/** Active facilities for an organization (shared with Edge org batch). */
export async function listActiveFacilitiesForOrganization(
  supabase: SupabaseClient,
  organizationId: string,
): Promise<{ id: string; name: string }[]> {
  const res = await supabase
    .from("facilities" as never)
    .select("id, name")
    .eq("organization_id", organizationId)
    .is("deleted_at", null)
    .eq("status", "active")
    .order("name", { ascending: true });
  if (res.error) throw new Error(res.error.message);
  return (res.data ?? []) as { id: string; name: string }[];
}
