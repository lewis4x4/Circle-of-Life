/**
 * Duplicated for Supabase Edge (deploy bundle is limited to `supabase/functions`).
 * Keep in sync with `src/lib/billing/generate-monthly-invoices.ts`.
 */
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.49.1";

/** Shared monthly invoice preview + persistence for admin UI and Edge Functions. Idempotent per (facility, resident, period_start) via DB unique index. */

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
  const billingMonthText = String(billingMonth).padStart(2, "0");
  const periodStart = `${billingYear}-${billingMonthText}-01`;
  const periodEnd = `${billingYear}-${billingMonthText}-${String(days).padStart(2, "0")}`;
  const dueDate = `${billingYear}-${billingMonthText}-15`;

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
      const admissionDate = r.admission_date?.slice(0, 10);
      if (admissionDate && admissionDate > periodStart && admissionDate <= periodEnd) {
        const admissionDay = Number(admissionDate.slice(8, 10));
        if (Number.isInteger(admissionDay) && admissionDay >= 1 && admissionDay <= days) {
          const daysPresent = days - admissionDay + 1;
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

  const rpcResult = (await supabase.rpc(
    "persist_monthly_invoices_from_preview",
    {
      p_facility_id: facilityId,
      p_billing_year: billingYear,
      p_billing_month: billingMonth,
      p_preview: preview,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_due_date: dueDate,
    } as never,
  )) as unknown as {
    data: { created_count: number | null; skipped_duplicates: number | null }[] | null;
    error: QueryError | null;
  };

  if (rpcResult.error) throw new Error(rpcResult.error.message);

  const row = rpcResult.data?.[0];
  return {
    createdCount: row?.created_count ?? 0,
    skippedDuplicates: row?.skipped_duplicates ?? 0,
  };
}

/** Active facilities for an organization (Edge cron org-wide orchestration). Duplicated in `src/lib/billing/generate-monthly-invoices.ts`. */
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
