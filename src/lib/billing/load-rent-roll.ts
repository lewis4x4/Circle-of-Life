import type { SupabaseClient } from "@supabase/supabase-js";

import { RESIDENT_NO_BED_COPY } from "@/lib/residents/roster-display-copy";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

import {
  buildRentRoll,
  rentRollPeriodBounds,
  type RentRoll,
  type RentRollCollectionNoteInput,
  type RentRollInvoiceInput,
  type RentRollPayerInput,
  type RentRollPaymentInput,
  type RentRollPeriod,
  type RentRollResidentInput,
} from "./rent-roll-model";

/**
 * Loads one facility's month onto the rent roll (COL-583).
 *
 * Reads only what Haven already keeps: residents (with their bed → room),
 * resident_payers (with the facility's Medicaid plan catalog), payments,
 * invoices and collection_activities. Posts nothing.
 *
 * `src/types/database.ts` predates several of these columns, so the tables are
 * addressed with `as never` and the row shapes are typed by hand here, the same
 * way generate-monthly-invoices.ts does.
 */

type QueryListResult<T> = { data: T[] | null; error: { message: string } | null };

type BedJoin = {
  id: string;
  bed_label: string | null;
  rooms: { room_number: string | null } | { room_number: string | null }[] | null;
};

type ResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  status: string;
  admission_date: string | null;
  discharge_date: string | null;
  admission_source: string | null;
  monthly_total_rate: number | null;
  deleted_at: string | null;
  bed_by_id: BedJoin | BedJoin[] | null;
  beds: BedJoin | BedJoin[] | null;
};

type PayerRow = {
  resident_id: string;
  payer_type: string;
  payer_name: string | null;
  payer_share_type: string | null;
  payer_fixed_amount: number | null;
  medicaid_rate: number | null;
  medicaid_rate_unit: string | null;
  medicaid_patient_responsibility: number | null;
  effective_date: string;
  end_date: string | null;
  facility_medicaid_providers: { provider_name: string | null } | { provider_name: string | null }[] | null;
};

type PaymentRow = {
  resident_id: string;
  amount: number;
  payment_date: string;
  payment_method: string;
  payer_type: string | null;
  refunded: boolean | null;
  refund_amount: number | null;
};

type InvoiceRow = {
  resident_id: string;
  status: string;
  total: number;
  balance_due: number;
  invoice_date: string;
  period_start: string | null;
  payer_type?: string | null;
};

type PlanRateRow = {
  provider_name: string;
  default_rate_cents: number;
  rate_unit: string;
};

/** The facility's Medicaid plan catalog, shown as the sheet's rate legend. */
export type RentRollPlanRate = { name: string; rateCents: number; rateUnit: string };

export type RentRollLoad = { roll: RentRoll; planRates: RentRollPlanRate[] };

type CollectionActivityRow = {
  resident_id: string;
  activity_date: string;
  activity_type: string;
  description: string;
  outcome: string | null;
  follow_up_date: string | null;
};

const IN_BUILDING_STATUSES = ["active", "hospital_hold", "loa"] as const;
const LEFT_STATUSES = ["discharged", "deceased"] as const;

/** Bounded like every other billing hub read; a single building never approaches this. */
export const RENT_ROLL_RESIDENT_LIMIT = 300;
export const RENT_ROLL_ROW_LIMIT = 2000;

function one<T>(value: T | T[] | null): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value;
}

/** Same label the resident roster shows: room number, then bed letter. */
export function rentRollRoomLabel(resident: Pick<ResidentRow, "bed_by_id" | "beds">): { room: string | null; bed: string | null } {
  const bed = one(resident.bed_by_id) ?? one(resident.beds);
  const room = bed ? one(bed.rooms) : null;
  if (!room?.room_number) return { room: null, bed: null };
  const bedLabel = bed?.bed_label ?? null;
  // A bed label that already carries the room ("N101-A" in room "N101") is not prefixed again.
  const label = bedLabel ? (bedLabel.startsWith(room.room_number) ? bedLabel : `${room.room_number}-${bedLabel}`) : room.room_number;
  return { room: label, bed: bedLabel };
}

async function unwrap<T>(label: string, promise: PromiseLike<QueryListResult<T>>): Promise<T[]> {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data ?? [];
}

const RESIDENT_SELECT = `id, first_name, last_name, status, admission_date, discharge_date, admission_source, monthly_total_rate, deleted_at,
  bed_by_id: beds!residents_bed_id_fkey ( id, bed_label, rooms ( room_number ) ),
  beds!fk_beds_resident ( id, bed_label, rooms ( room_number ) )`;

export async function fetchRentRollFromSupabase(
  facilityId: string | null,
  period: RentRollPeriod,
  supabase: SupabaseClient,
): Promise<RentRollLoad> {
  if (!isValidFacilityIdForQuery(facilityId)) {
    throw new Error("Rent roll is per facility; no facility id was given.");
  }
  const bounds = rentRollPeriodBounds(period);

  // Residents in the building at any point in the month: everyone currently
  // in-house, on hospital hold or on leave, plus anyone who left on or after the 1st.
  const inBuildingQuery = supabase
    .from("residents" as never)
    .select(RESIDENT_SELECT)
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", [...IN_BUILDING_STATUSES])
    .limit(RENT_ROLL_RESIDENT_LIMIT) as unknown as PromiseLike<QueryListResult<ResidentRow>>;

  const leftQuery = supabase
    .from("residents" as never)
    .select(RESIDENT_SELECT)
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .in("status", [...LEFT_STATUSES])
    .gte("discharge_date", bounds.startIso)
    .limit(RENT_ROLL_RESIDENT_LIMIT) as unknown as PromiseLike<QueryListResult<ResidentRow>>;

  const payersQuery = supabase
    .from("resident_payers" as never)
    .select(
      "resident_id, payer_type, payer_name, payer_share_type, payer_fixed_amount, medicaid_rate, medicaid_rate_unit, medicaid_patient_responsibility, effective_date, end_date, facility_medicaid_providers ( provider_name )",
    )
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .lte("effective_date", bounds.endIso)
    .or(`end_date.is.null,end_date.gte.${bounds.startIso}`)
    .limit(RENT_ROLL_ROW_LIMIT) as unknown as PromiseLike<QueryListResult<PayerRow>>;

  const paymentsQuery = supabase
    .from("payments" as never)
    .select("resident_id, amount, payment_date, payment_method, payer_type, refunded, refund_amount")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("payment_date", bounds.startIso)
    .lt("payment_date", bounds.endExclusiveIso)
    .limit(RENT_ROLL_ROW_LIMIT) as unknown as PromiseLike<QueryListResult<PaymentRow>>;

  const invoicesQuery = supabase
    .from("invoices" as never)
    .select("resident_id, status, total, balance_due, invoice_date, period_start, payer_type")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .gte("invoice_date", bounds.startIso)
    .lt("invoice_date", bounds.endExclusiveIso)
    .limit(RENT_ROLL_ROW_LIMIT) as unknown as PromiseLike<QueryListResult<InvoiceRow>>;

  const notesQuery = supabase
    .from("collection_activities" as never)
    .select("resident_id, activity_date, activity_type, description, outcome, follow_up_date")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .lte("activity_date", bounds.endIso)
    .order("activity_date", { ascending: false })
    .limit(RENT_ROLL_ROW_LIMIT) as unknown as PromiseLike<QueryListResult<CollectionActivityRow>>;

  const planRatesQuery = supabase
    .from("facility_medicaid_providers" as never)
    .select("provider_name, default_rate_cents, rate_unit")
    .eq("facility_id", facilityId)
    .eq("active", true)
    .is("deleted_at", null)
    .order("provider_name", { ascending: true })
    .limit(50) as unknown as PromiseLike<QueryListResult<PlanRateRow>>;

  const [inBuilding, left, payerRows, paymentRows, invoiceRows, noteRows, planRateRows] = await Promise.all([
    unwrap("residents", inBuildingQuery),
    unwrap("residents (left this month)", leftQuery),
    unwrap("resident_payers", payersQuery),
    unwrap("payments", paymentsQuery),
    unwrap("invoices", invoicesQuery),
    unwrap("collection_activities", notesQuery),
    unwrap("facility_medicaid_providers", planRatesQuery),
  ]);

  const seen = new Set<string>();
  const residents: RentRollResidentInput[] = [];
  for (const row of [...inBuilding, ...left]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const { room, bed } = rentRollRoomLabel(row);
    residents.push({
      id: row.id,
      firstName: row.first_name ?? "",
      lastName: row.last_name ?? "",
      status: row.status,
      admissionDate: row.admission_date,
      dischargeDate: row.discharge_date,
      admissionSource: row.admission_source,
      monthlyTotalRateCents: row.monthly_total_rate,
      roomLabel: room,
      bedLabel: bed,
    });
  }

  const payers: RentRollPayerInput[] = payerRows.map((row) => ({
    residentId: row.resident_id,
    payerType: row.payer_type,
    payerName: row.payer_name,
    providerName: one(row.facility_medicaid_providers)?.provider_name ?? null,
    payerShareType: row.payer_share_type ?? "full",
    payerFixedAmountCents: row.payer_fixed_amount,
    medicaidRateCents: row.medicaid_rate,
    medicaidRateUnit: row.medicaid_rate_unit,
    medicaidPatientResponsibilityCents: row.medicaid_patient_responsibility,
    effectiveDate: row.effective_date,
    endDate: row.end_date,
  }));

  const payments: RentRollPaymentInput[] = paymentRows.map((row) => ({
    residentId: row.resident_id,
    amountCents: row.amount,
    paymentDate: row.payment_date,
    paymentMethod: row.payment_method,
    payerType: row.payer_type,
    refunded: row.refunded === true,
    refundAmountCents: row.refund_amount,
  }));

  const invoices: RentRollInvoiceInput[] = invoiceRows.map((row) => ({
    residentId: row.resident_id,
    status: row.status,
    totalCents: row.total,
    balanceDueCents: row.balance_due,
    invoiceDate: row.invoice_date,
    periodStart: row.period_start,
    payerType: row.payer_type ?? null,
  }));

  const collectionNotes: RentRollCollectionNoteInput[] = noteRows.map((row) => ({
    residentId: row.resident_id,
    activityDate: row.activity_date,
    activityType: row.activity_type,
    description: row.description,
    outcome: row.outcome,
    followUpDate: row.follow_up_date,
  }));

  const planRates: RentRollPlanRate[] = planRateRows.map((row) => ({
    name: row.provider_name,
    rateCents: row.default_rate_cents,
    rateUnit: row.rate_unit,
  }));

  return { roll: buildRentRoll({ period, residents, payers, payments, invoices, collectionNotes }), planRates };
}

export { RESIDENT_NO_BED_COPY as RENT_ROLL_NO_BED_COPY };
