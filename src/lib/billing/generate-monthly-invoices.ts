/**
 * Shared monthly invoice preview + persistence for admin UI and Edge Functions.
 * Idempotent per (facility, resident, period_start) via DB unique index (migration 071).
 * Edge duplicate: `supabase/functions/_shared/billing/generate-monthly-invoices.ts`.
 *
 * BH-3 (Michelle 2026-07): bill active + hospital_hold + loa; Medicaid catalog rates;
 * admission + discharge proration; due date = 5th of billing month.
 * Private-pay holds bill full monthly rent (not reduced daily bed_hold).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type QueryError = { message: string; code?: string };

export type Resident = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  acuity_level: string;
  status: string;
  admission_date: string | null;
  discharge_date: string | null;
  facility_id: string;
  organization_id: string;
  monthly_base_rate: number | null;
  monthly_care_surcharge: number | null;
  monthly_total_rate: number | null;
  rate_effective_date: string | null;
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
  medicaid_rate: number | null;
  facility_medicaid_provider_id: string | null;
};

export type FacilityMedicaidProvider = {
  id: string;
  default_rate_cents: number;
  rate_unit: string;
  provider_name: string;
};

export type ResidentRateAgreement = {
  id: string;
  resident_id: string;
  room_class: "private" | "companion" | "other";
  negotiated_base_rate: number;
  negotiated_care_surcharge: number | null;
  negotiated_monthly_total: number;
  care_charge_mode: "standard" | "flat" | "bundled" | "waived";
  concession_reason: string;
  effective_date: string;
  end_date: string | null;
};

export type BillingSource =
  | "resident_rate_agreement"
  | "legacy_resident_rate"
  | "standard_rate_schedule"
  | "medicaid_provider_rate"
  | "medicaid_resident_override";

/** Presence statuses that remain billable until official discharge. */
export const BILLABLE_RESIDENT_STATUSES = ["active", "hospital_hold", "loa"] as const;

export type PreviewLine = {
  residentId: string;
  residentName: string;
  payerType: string;
  payerName: string;
  standardBaseRate: number;
  standardCareSurcharge: number;
  standardTotal: number;
  negotiatedBaseRate: number;
  negotiatedCareSurcharge: number;
  concessionAmount: number;
  baseRate: number;
  careSurcharge: number;
  total: number;
  acuity: string;
  roomClass: "private" | "companion" | "other";
  billingSource: BillingSource;
  concessionReason: string | null;
  agreementId: string | null;
  prorated: boolean;
  presenceStatus: string;
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

function roomBaseRate(rate: RateSchedule, roomClass: "private" | "companion" | "other"): number {
  if (roomClass === "companion") return rate.base_rate_semi_private ?? rate.base_rate_private;
  return rate.base_rate_private;
}

function roomClassLabel(roomClass: "private" | "companion" | "other"): string {
  if (roomClass === "companion") return "Companion Room";
  if (roomClass === "other") return "Room and Board";
  return "Private Room";
}

function reasonLabel(reason: string | null | undefined): string {
  if (!reason || reason === "none") return "Negotiated rate";
  return reason
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function prorateAmount(amount: number, factor: number): number {
  return Math.round(amount * factor);
}

/** Parse YYYY-MM-DD as local calendar date (avoids UTC day shift). */
export function parseDateOnly(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Billable-day factor for the calendar month.
 * - Admission mid-month → from admit day through month end (or discharge if earlier).
 * - Discharge mid-month → from month start (or admit if later) through discharge day.
 * - Full month if neither boundary falls inside the period.
 */
export function prorationFactorForResident(
  resident: Pick<Resident, "admission_date" | "discharge_date">,
  billingYear: number,
  billingMonth: number,
  days: number,
): { factor: number; prorated: boolean } {
  const periodStart = new Date(billingYear, billingMonth - 1, 1);
  const periodEnd = new Date(billingYear, billingMonth - 1, days);
  const adm = parseDateOnly(resident.admission_date);
  const dis = parseDateOnly(resident.discharge_date);

  let startDay = 1;
  let endDay = days;
  let prorated = false;

  if (adm && adm.getFullYear() === billingYear && adm.getMonth() === billingMonth - 1) {
    startDay = adm.getDate();
    prorated = true;
  } else if (adm && adm > periodEnd) {
    return { factor: 0, prorated: true };
  }

  if (dis && dis.getFullYear() === billingYear && dis.getMonth() === billingMonth - 1) {
    endDay = dis.getDate();
    prorated = true;
  } else if (dis && dis < periodStart) {
    return { factor: 0, prorated: true };
  }

  if (endDay < startDay) return { factor: 0, prorated: true };
  const daysPresent = endDay - startDay + 1;
  if (!prorated) return { factor: 1, prorated: false };
  return { factor: Math.max(0, daysPresent) / days, prorated: true };
}

export function isMedicaidPayer(payerType: string | null | undefined): boolean {
  return payerType === "medicaid_oss";
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
  // Michelle: private-pay rent due by the 5th.
  const dueDate = `${billingYear}-${billingMonthText}-05`;

  type QR<T> = { data: T | null; error: QueryError | null };

  const resP = supabase
    .from("residents" as never)
    .select(
      "id, first_name, last_name, acuity_level, status, admission_date, discharge_date, facility_id, organization_id, monthly_base_rate, monthly_care_surcharge, monthly_total_rate, rate_effective_date",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", [...BILLABLE_RESIDENT_STATUSES])
    .limit(500);

  const rateP = supabase
    .from("rate_schedules" as never)
    .select(
      "id, base_rate_private, base_rate_semi_private, care_surcharge_level_1, care_surcharge_level_2, care_surcharge_level_3",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .lte("effective_date", periodStart)
    .or(`end_date.is.null,end_date.gte.${periodStart}`)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  const payerP = supabase
    .from("resident_payers" as never)
    .select("resident_id, payer_type, payer_name, medicaid_rate, facility_medicaid_provider_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .or(`end_date.is.null,end_date.gte.${periodStart}`)
    .eq("is_primary", true);

  const medicaidP = supabase
    .from("facility_medicaid_providers" as never)
    .select("id, default_rate_cents, rate_unit, provider_name")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("active", true);

  const agreementP = supabase
    .from("resident_rate_agreements" as never)
    .select(
      "id, resident_id, room_class, negotiated_base_rate, negotiated_care_surcharge, negotiated_monthly_total, care_charge_mode, concession_reason, effective_date, end_date",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("status", "active")
    .lte("effective_date", periodStart)
    .or(`end_date.is.null,end_date.gte.${periodStart}`)
    .order("effective_date", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(500);

  const existingP = supabase
    .from("invoices" as never)
    .select("resident_id")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .eq("period_start", periodStart)
    .limit(500);

  const [resResult, rateResult, payerResult, medicaidResult, agreementResult, existingResult] =
    (await Promise.all([resP, rateP, payerP, medicaidP, agreementP, existingP])) as unknown as [
      QR<Resident[]>,
      QR<RateSchedule[]>,
      QR<ResidentPayer[]>,
      QR<FacilityMedicaidProvider[]>,
      QR<ResidentRateAgreement[]>,
      QR<{ resident_id: string }[]>,
    ];

  for (const result of [
    existingResult,
    resResult,
    rateResult,
    payerResult,
    medicaidResult,
    agreementResult,
  ]) {
    if (result.error) {
      return {
        preview: [],
        error: result.error.message,
        billingLabel,
        days,
        periodStart,
        periodEnd,
        dueDate,
      };
    }
  }

  const residents = resResult.data ?? [];
  const rate = (rateResult.data ?? [])[0];
  const payers = payerResult.data ?? [];
  const medicaidProviders = medicaidResult.data ?? [];
  const agreements = agreementResult.data ?? [];
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
  const medicaidById = new Map(medicaidProviders.map((p) => [p.id, p]));
  const agreementMap = new Map<string, ResidentRateAgreement>();
  for (const agreement of agreements) {
    if (!agreementMap.has(agreement.resident_id)) {
      agreementMap.set(agreement.resident_id, agreement);
    }
  }

  const medicaidRateMissing: string[] = [];

  const preview: PreviewLine[] = residents
    .filter((r) => !alreadyInvoiced.has(r.id))
    .map((r): PreviewLine | null => {
      const name = `${(r.last_name ?? "").trim()}, ${(r.first_name ?? "").trim()}`.replace(
        /^, |, $/,
        "",
      );
      const payer = payerMap.get(r.id);
      const payerType = payer?.payer_type ?? "private_pay";
      const surcharge = surchargeForAcuity(rate, r.acuity_level);
      const { factor, prorated } = prorationFactorForResident(r, billingYear, billingMonth, days);
      const agreement = agreementMap.get(r.id);

      let roomClass: "private" | "companion" | "other" = "private";
      let billingSource: BillingSource = "standard_rate_schedule";
      let agreementId: string | null = null;
      let concessionReason: string | null = null;

      let standardBaseRate = roomBaseRate(rate, roomClass);
      let standardCareSurcharge = surcharge.cents;
      let standardTotal = standardBaseRate + standardCareSurcharge;
      let negotiatedBaseRate = standardBaseRate;
      let negotiatedCareSurcharge = standardCareSurcharge;
      let negotiatedTotal = standardTotal;

      if (isMedicaidPayer(payerType)) {
        const override = payer?.medicaid_rate != null && payer.medicaid_rate > 0 ? payer.medicaid_rate : null;
        const catalog = payer?.facility_medicaid_provider_id
          ? medicaidById.get(payer.facility_medicaid_provider_id)
          : null;
        const medicaidMonthly =
          override ??
          (catalog && catalog.rate_unit === "monthly" ? catalog.default_rate_cents : null) ??
          (catalog && catalog.rate_unit === "daily"
            ? catalog.default_rate_cents * days
            : null);

        if (medicaidMonthly == null || medicaidMonthly <= 0) {
          // Never fall through to the private-pay schedule for a Medicaid resident —
          // skip and surface a warning so staff link a provider or set an override.
          medicaidRateMissing.push(name || r.id);
          return null;
        }
        billingSource = override != null ? "medicaid_resident_override" : "medicaid_provider_rate";
        concessionReason = null;
        standardBaseRate = medicaidMonthly;
        standardCareSurcharge = 0;
        standardTotal = medicaidMonthly;
        negotiatedBaseRate = medicaidMonthly;
        negotiatedCareSurcharge = 0;
        negotiatedTotal = medicaidMonthly;
        roomClass = "other";
      } else if (agreement) {
        roomClass = agreement.room_class;
        billingSource = "resident_rate_agreement";
        agreementId = agreement.id;
        concessionReason = agreement.concession_reason;
        standardBaseRate = roomBaseRate(rate, roomClass);
        standardCareSurcharge = surcharge.cents;
        standardTotal = standardBaseRate + standardCareSurcharge;
        negotiatedBaseRate = agreement.negotiated_base_rate;
        negotiatedCareSurcharge =
          agreement.care_charge_mode === "standard"
            ? standardCareSurcharge
            : agreement.care_charge_mode === "flat"
              ? agreement.negotiated_care_surcharge ?? 0
              : 0;
        negotiatedTotal = agreement.negotiated_monthly_total;
      } else if (
        r.monthly_total_rate != null &&
        r.monthly_total_rate > 0 &&
        (!r.rate_effective_date || r.rate_effective_date <= periodStart)
      ) {
        billingSource = "legacy_resident_rate";
        concessionReason = "legacy_rate_lock";
        negotiatedTotal = r.monthly_total_rate;
        negotiatedBaseRate = r.monthly_base_rate ?? r.monthly_total_rate;
        negotiatedCareSurcharge = Math.max(0, negotiatedTotal - negotiatedBaseRate);
      }

      standardBaseRate = prorateAmount(standardBaseRate, factor);
      standardCareSurcharge = prorateAmount(standardCareSurcharge, factor);
      // The RPC requires non-adjustment line items to sum exactly to p_subtotal,
      // so the subtotal must be the sum of the already-rounded line amounts —
      // rounding the prorated total independently can drift by a cent.
      standardTotal = standardBaseRate + standardCareSurcharge;
      negotiatedBaseRate = prorateAmount(negotiatedBaseRate, factor);
      negotiatedCareSurcharge = prorateAmount(negotiatedCareSurcharge, factor);
      negotiatedTotal = prorateAmount(negotiatedTotal, factor);
      const concessionAmount = standardTotal - negotiatedTotal;

      return {
        residentId: r.id,
        residentName: name,
        payerType,
        payerName: payer?.payer_name ?? (isMedicaidPayer(payerType) ? "Medicaid" : "Responsible party"),
        standardBaseRate,
        standardCareSurcharge,
        standardTotal,
        negotiatedBaseRate,
        negotiatedCareSurcharge,
        concessionAmount,
        baseRate: standardBaseRate,
        careSurcharge: standardCareSurcharge,
        total: negotiatedTotal,
        acuity: isMedicaidPayer(payerType) ? "Medicaid" : surcharge.label,
        roomClass,
        billingSource,
        concessionReason,
        agreementId,
        prorated,
        presenceStatus: r.status,
      };
    })
    .filter((line): line is PreviewLine =>
      line != null && (line.total > 0 || line.standardTotal > 0),
    );

  let message: string | null = null;
  if (medicaidRateMissing.length > 0) {
    message = `Skipped ${medicaidRateMissing.length} Medicaid resident(s) with no usable rate (link a facility Medicaid provider or set a resident rate override): ${medicaidRateMissing.join("; ")}.`;
  } else if (alreadyInvoiced.size > 0 && preview.length === 0 && residents.length > 0) {
    message = `All ${residents.length} billable residents already have invoices for ${billingLabel}. No new invoices to generate.`;
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

  const facilityCode = facilityId.replace(/-/g, "").slice(0, 8).toUpperCase();

  let createdCount = 0;
  let skippedDuplicates = 0;

  const ym = `${billingYear}-${String(billingMonth).padStart(2, "0")}`;
  for (let i = 0; i < preview.length; i++) {
    const line = preview[i];
    const invoiceNumber = `${facilityCode}-${ym}-${line.residentId}`;

    const holdNote =
      line.presenceStatus === "hospital_hold" || line.presenceStatus === "loa"
        ? " (bed hold — full monthly per COL policy)"
        : "";

    const lineItems = [
      {
        line_type: "room_and_board",
        description: line.prorated
          ? `${roomClassLabel(line.roomClass)} — Prorated${holdNote} (${monthLabel(billingYear, billingMonth)})`
          : `${roomClassLabel(line.roomClass)} — Standard monthly rate${holdNote}`,
        quantity: 1,
        unit_price: line.standardBaseRate,
        total: line.standardBaseRate,
        sort_order: 1,
      },
    ];

    if (line.standardCareSurcharge > 0) {
      lineItems.push({
        line_type: "care_surcharge",
        description: `${line.acuity} Care Surcharge`,
        quantity: 1,
        unit_price: line.standardCareSurcharge,
        total: line.standardCareSurcharge,
        sort_order: 2,
      });
    }

    if (line.concessionAmount !== 0) {
      const credit = -line.concessionAmount;
      lineItems.push({
        line_type: line.concessionAmount > 0 ? "negotiated_concession" : "rate_premium",
        description:
          line.concessionAmount > 0
            ? `${reasonLabel(line.concessionReason)} — negotiated rate concession`
            : "Rate premium above posted standard",
        quantity: 1,
        unit_price: credit,
        total: credit,
        sort_order: 90,
      });
    }

    const notes =
      line.billingSource === "resident_rate_agreement"
        ? `Generated from resident negotiated billing agreement ${line.agreementId}.`
        : line.billingSource === "legacy_resident_rate"
          ? "Generated from imported resident monthly rate until a negotiated agreement is confirmed."
          : line.billingSource === "medicaid_provider_rate" ||
              line.billingSource === "medicaid_resident_override"
            ? "Generated from Medicaid provider / resident override rate (Michelle COL defaults)."
            : line.presenceStatus === "hospital_hold" || line.presenceStatus === "loa"
              ? "Generated while resident on bed hold — full monthly rent per COL policy."
              : null;

    const rpcResult = (await supabase.rpc("haven_create_invoice_with_line_items" as never, {
      p_facility_id: facilityId,
      p_resident_id: line.residentId,
      p_invoice_number: invoiceNumber,
      p_invoice_date: periodStart,
      p_due_date: dueDate,
      p_period_start: periodStart,
      p_period_end: periodEnd,
      p_subtotal: line.standardTotal,
      p_adjustments: -line.concessionAmount,
      p_tax: 0,
      p_total: line.total,
      p_amount_paid: 0,
      p_balance_due: line.total,
      p_payer_type: line.payerType,
      p_payer_name: line.payerName,
      p_notes: notes,
      p_line_items: lineItems,
    } as never)) as unknown as {
      data: { invoice_id: string | null; inserted: boolean }[] | null;
      error: QueryError | null;
    };

    if (rpcResult.error) throw new Error(rpcResult.error.message);
    const result = rpcResult.data?.[0];
    if (!result) throw new Error("Invoice creation returned no result.");
    if (!result.inserted) {
      skippedDuplicates += 1;
      continue;
    }

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
