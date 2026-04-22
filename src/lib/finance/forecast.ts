import type { Enums, Tables } from "@/types/database";

export type ForecastFacility = Pick<Tables<"facilities">, "id" | "name" | "entity_id">;

export type ForecastInvoice = Pick<
  Tables<"invoices">,
  "id" | "facility_id" | "resident_id" | "invoice_date" | "due_date" | "total" | "balance_due" | "status"
>;

export type ForecastPayment = Pick<Tables<"payments">, "facility_id" | "payment_date" | "amount">;

export type ForecastTrustEntry = Pick<
  Tables<"trust_account_entries">,
  "resident_id" | "facility_id" | "entry_date" | "balance_after_cents"
>;

export type ForecastTimeRecord = Pick<
  Tables<"time_records">,
  "staff_id" | "facility_id" | "clock_in" | "actual_hours" | "regular_hours" | "overtime_hours"
>;

export type ForecastStaffRate = Pick<
  Tables<"staff">,
  "id" | "facility_id" | "hourly_rate" | "overtime_rate" | "employment_status" | "staff_role"
>;

export type ForecastVendorInvoice = Pick<
  Tables<"vendor_invoices">,
  "facility_id" | "invoice_date" | "status" | "total_cents"
>;

export type ForecastResident = Pick<Tables<"residents">, "id" | "facility_id" | "status">;

export type ForecastFacilityAsset = {
  id: string;
  facility_id: string;
  asset_type: string;
  name: string;
  status: string;
  lifecycle_replace_by: string | null;
  replacement_cost_estimate_cents: number | null;
};

export type DsoFacilityRow = {
  facilityId: string;
  facilityName: string;
  openArCents: number;
  trustCoverageCents: number;
  netExposureCents: number;
  trailing90BilledCents: number;
  trailing90CollectedCents: number;
  currentDsoDays: number;
  projected30DayDsoDays: number;
  collectionEfficiencyPct: number;
};

export type DsoSummary = {
  openArCents: number;
  trustCoverageCents: number;
  netExposureCents: number;
  trailing90BilledCents: number;
  trailing90CollectedCents: number;
  currentDsoDays: number;
  projected30DayDsoDays: number;
  collectionEfficiencyPct: number;
};

export type CostToServeFacilityRow = {
  facilityId: string;
  facilityName: string;
  activeResidents: number;
  laborCostCents: number;
  vendorCostCents: number;
  totalCostCents: number;
  costPerResidentCents: number | null;
  approvedHours: number;
  overtimeHours: number;
};

export type CostToServeSummary = {
  activeResidents: number;
  laborCostCents: number;
  vendorCostCents: number;
  totalCostCents: number;
  costPerResidentCents: number | null;
  approvedHours: number;
  overtimeHours: number;
};

export type CapexFacilityRow = {
  facilityId: string;
  facilityName: string;
  overdueCount: number;
  overdueCostCents: number;
  due12MonthsCount: number;
  due12MonthsCostCents: number;
  due36MonthsCount: number;
  due36MonthsCostCents: number;
};

export type CapexDueAssetRow = {
  id: string;
  facilityId: string;
  facilityName: string;
  assetType: string;
  assetName: string;
  status: string;
  dueDate: string;
  replacementCostCents: number;
  monthsFromNow: number;
};

export type CapexSummary = {
  overdueCount: number;
  overdueCostCents: number;
  due12MonthsCount: number;
  due12MonthsCostCents: number;
  due36MonthsCount: number;
  due36MonthsCostCents: number;
};

type ForecastScopeMapRow = {
  facilityName: string;
  entityId: string;
};

type MutableCapexFacilityRow = {
  overdueCount: number;
  overdueCostCents: number;
  due12MonthsCount: number;
  due12MonthsCostCents: number;
  due36MonthsCount: number;
  due36MonthsCostCents: number;
};

const OPEN_AR_STATUSES = new Set<Enums<"invoice_status">>(["sent", "partial", "overdue"]);
const BILLED_STATUSES = new Set<Enums<"invoice_status">>(["sent", "paid", "partial", "overdue"]);
const ACTIVE_RESIDENT_STATUSES = new Set<Enums<"resident_status">>(["active", "hospital_hold", "loa"]);
const INCLUDED_VENDOR_STATUSES = new Set<Enums<"vendor_invoice_status">>(["submitted", "approved", "matched", "paid"]);

function sumNumbers(values: Iterable<number>): number {
  let total = 0;
  for (const value of values) total += value;
  return total;
}

function roundMoney(value: number): number {
  return Number.isFinite(value) ? Math.round(value) : 0;
}

function safePercent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return (numerator / denominator) * 100;
}

function safeDays(openBalanceCents: number, billedCents: number, billedWindowDays: number): number {
  if (billedCents <= 0 || billedWindowDays <= 0) return 0;
  const averageDailyBilling = billedCents / billedWindowDays;
  return averageDailyBilling > 0 ? openBalanceCents / averageDailyBilling : 0;
}

function monthsFromNow(dateString: string, today: Date): number {
  const due = new Date(dateString);
  const diffMs = due.getTime() - today.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);
  return Math.round(diffDays / 30.4375);
}

function buildScopeMap(facilities: ForecastFacility[]): Map<string, ForecastScopeMapRow> {
  return new Map(
    facilities.map((facility) => [
      facility.id,
      {
        facilityName: facility.name,
        entityId: facility.entity_id,
      },
    ]),
  );
}

export function buildDsoForecast(input: {
  facilities: ForecastFacility[];
  openInvoices: ForecastInvoice[];
  billedInvoices90d: ForecastInvoice[];
  payments90d: ForecastPayment[];
  trustEntries: ForecastTrustEntry[];
  billedWindowDays?: number;
}): { summary: DsoSummary; rows: DsoFacilityRow[] } {
  const billedWindowDays = input.billedWindowDays ?? 90;
  const scopeMap = buildScopeMap(input.facilities);
  const openArByFacility = new Map<string, number>();
  const billedByFacility = new Map<string, number>();
  const collectedByFacility = new Map<string, number>();
  const latestTrustByResident = new Map<string, { facilityId: string; entryDate: string; balanceAfterCents: number }>();

  for (const invoice of input.openInvoices) {
    if (!OPEN_AR_STATUSES.has(invoice.status)) continue;
    openArByFacility.set(invoice.facility_id, (openArByFacility.get(invoice.facility_id) ?? 0) + Math.max(invoice.balance_due, 0));
  }

  for (const invoice of input.billedInvoices90d) {
    if (!BILLED_STATUSES.has(invoice.status)) continue;
    billedByFacility.set(invoice.facility_id, (billedByFacility.get(invoice.facility_id) ?? 0) + Math.max(invoice.total, 0));
  }

  for (const payment of input.payments90d) {
    collectedByFacility.set(payment.facility_id, (collectedByFacility.get(payment.facility_id) ?? 0) + Math.max(payment.amount, 0));
  }

  for (const entry of input.trustEntries) {
    const existing = latestTrustByResident.get(entry.resident_id);
    if (!existing || entry.entry_date > existing.entryDate) {
      latestTrustByResident.set(entry.resident_id, {
        facilityId: entry.facility_id,
        entryDate: entry.entry_date,
        balanceAfterCents: entry.balance_after_cents,
      });
    }
  }

  const trustByFacility = new Map<string, number>();
  for (const latestEntry of latestTrustByResident.values()) {
    trustByFacility.set(
      latestEntry.facilityId,
      (trustByFacility.get(latestEntry.facilityId) ?? 0) + Math.max(latestEntry.balanceAfterCents, 0),
    );
  }

  const facilityIds = new Set<string>([
    ...input.facilities.map((facility) => facility.id),
    ...openArByFacility.keys(),
    ...billedByFacility.keys(),
    ...collectedByFacility.keys(),
    ...trustByFacility.keys(),
  ]);

  const rows = Array.from(facilityIds)
    .map((facilityId) => {
      const facility = scopeMap.get(facilityId);
      const openArCents = openArByFacility.get(facilityId) ?? 0;
      const trailing90BilledCents = billedByFacility.get(facilityId) ?? 0;
      const trailing90CollectedCents = collectedByFacility.get(facilityId) ?? 0;
      const trustCoverageCents = trustByFacility.get(facilityId) ?? 0;
      const projectedEndingArCents = Math.max(
        0,
        openArCents + roundMoney(trailing90BilledCents / 3) - roundMoney(trailing90CollectedCents / 3),
      );

      return {
        facilityId,
        facilityName: facility?.facilityName ?? facilityId,
        openArCents,
        trustCoverageCents,
        netExposureCents: Math.max(0, openArCents - trustCoverageCents),
        trailing90BilledCents,
        trailing90CollectedCents,
        currentDsoDays: safeDays(openArCents, trailing90BilledCents, billedWindowDays),
        projected30DayDsoDays: safeDays(projectedEndingArCents, trailing90BilledCents, billedWindowDays),
        collectionEfficiencyPct: safePercent(trailing90CollectedCents, trailing90BilledCents),
      } satisfies DsoFacilityRow;
    })
    .sort((left, right) => right.openArCents - left.openArCents);

  const summary = {
    openArCents: sumNumbers(rows.map((row) => row.openArCents)),
    trustCoverageCents: sumNumbers(rows.map((row) => row.trustCoverageCents)),
    netExposureCents: sumNumbers(rows.map((row) => row.netExposureCents)),
    trailing90BilledCents: sumNumbers(rows.map((row) => row.trailing90BilledCents)),
    trailing90CollectedCents: sumNumbers(rows.map((row) => row.trailing90CollectedCents)),
    currentDsoDays: safeDays(
      sumNumbers(rows.map((row) => row.openArCents)),
      sumNumbers(rows.map((row) => row.trailing90BilledCents)),
      billedWindowDays,
    ),
    projected30DayDsoDays: safeDays(
      sumNumbers(
        rows.map((row) =>
          Math.max(
            0,
            row.openArCents + roundMoney(row.trailing90BilledCents / 3) - roundMoney(row.trailing90CollectedCents / 3),
          ),
        ),
      ),
      sumNumbers(rows.map((row) => row.trailing90BilledCents)),
      billedWindowDays,
    ),
    collectionEfficiencyPct: safePercent(
      sumNumbers(rows.map((row) => row.trailing90CollectedCents)),
      sumNumbers(rows.map((row) => row.trailing90BilledCents)),
    ),
  } satisfies DsoSummary;

  return { summary, rows };
}

export function buildCostToServeForecast(input: {
  facilities: ForecastFacility[];
  residents: ForecastResident[];
  timeRecords30d: ForecastTimeRecord[];
  staffRates: ForecastStaffRate[];
  vendorInvoices30d: ForecastVendorInvoice[];
}): { summary: CostToServeSummary; rows: CostToServeFacilityRow[] } {
  const scopeMap = buildScopeMap(input.facilities);
  const residentCountByFacility = new Map<string, number>();
  const laborByFacility = new Map<string, { costCents: number; approvedHours: number; overtimeHours: number }>();
  const vendorByFacility = new Map<string, number>();
  const staffRateMap = new Map<string, ForecastStaffRate>(input.staffRates.map((staff) => [staff.id, staff]));

  for (const resident of input.residents) {
    if (!ACTIVE_RESIDENT_STATUSES.has(resident.status)) continue;
    residentCountByFacility.set(resident.facility_id, (residentCountByFacility.get(resident.facility_id) ?? 0) + 1);
  }

  for (const record of input.timeRecords30d) {
    const staffRate = staffRateMap.get(record.staff_id);
    const baseRate = staffRate?.hourly_rate ?? 0;
    const overtimeRate = staffRate?.overtime_rate ?? roundMoney(baseRate * 1.5);
    const overtimeHours = Math.max(record.overtime_hours ?? 0, 0);
    const totalHours = Math.max(record.actual_hours ?? (record.regular_hours ?? 0) + overtimeHours, 0);
    const regularHours = Math.max(record.regular_hours ?? totalHours - overtimeHours, 0);
    const laborCostCents = roundMoney(regularHours * baseRate + overtimeHours * overtimeRate);
    const snapshot = laborByFacility.get(record.facility_id) ?? {
      costCents: 0,
      approvedHours: 0,
      overtimeHours: 0,
    };
    snapshot.costCents += laborCostCents;
    snapshot.approvedHours += totalHours;
    snapshot.overtimeHours += overtimeHours;
    laborByFacility.set(record.facility_id, snapshot);
  }

  for (const invoice of input.vendorInvoices30d) {
    if (!INCLUDED_VENDOR_STATUSES.has(invoice.status)) continue;
    vendorByFacility.set(invoice.facility_id, (vendorByFacility.get(invoice.facility_id) ?? 0) + Math.max(invoice.total_cents, 0));
  }

  const facilityIds = new Set<string>([
    ...input.facilities.map((facility) => facility.id),
    ...residentCountByFacility.keys(),
    ...laborByFacility.keys(),
    ...vendorByFacility.keys(),
  ]);

  const rows = Array.from(facilityIds)
    .map((facilityId) => {
      const facility = scopeMap.get(facilityId);
      const labor = laborByFacility.get(facilityId) ?? { costCents: 0, approvedHours: 0, overtimeHours: 0 };
      const vendorCostCents = vendorByFacility.get(facilityId) ?? 0;
      const activeResidents = residentCountByFacility.get(facilityId) ?? 0;
      const totalCostCents = labor.costCents + vendorCostCents;
      return {
        facilityId,
        facilityName: facility?.facilityName ?? facilityId,
        activeResidents,
        laborCostCents: labor.costCents,
        vendorCostCents,
        totalCostCents,
        costPerResidentCents: activeResidents > 0 ? roundMoney(totalCostCents / activeResidents) : null,
        approvedHours: labor.approvedHours,
        overtimeHours: labor.overtimeHours,
      } satisfies CostToServeFacilityRow;
    })
    .sort((left, right) => right.totalCostCents - left.totalCostCents);

  const totalResidents = sumNumbers(rows.map((row) => row.activeResidents));
  const totalLaborCostCents = sumNumbers(rows.map((row) => row.laborCostCents));
  const totalVendorCostCents = sumNumbers(rows.map((row) => row.vendorCostCents));
  const totalCostCents = totalLaborCostCents + totalVendorCostCents;

  return {
    summary: {
      activeResidents: totalResidents,
      laborCostCents: totalLaborCostCents,
      vendorCostCents: totalVendorCostCents,
      totalCostCents,
      costPerResidentCents: totalResidents > 0 ? roundMoney(totalCostCents / totalResidents) : null,
      approvedHours: sumNumbers(rows.map((row) => row.approvedHours)),
      overtimeHours: sumNumbers(rows.map((row) => row.overtimeHours)),
    },
    rows,
  };
}

export function buildCapexForecast(input: {
  facilities: ForecastFacility[];
  assets: ForecastFacilityAsset[];
  today?: Date;
}): { summary: CapexSummary; rows: CapexFacilityRow[]; dueSoon: CapexDueAssetRow[] } {
  const today = input.today ?? new Date();
  const scopeMap = buildScopeMap(input.facilities);
  const facilityRows = new Map<string, MutableCapexFacilityRow>();
  const dueSoon: CapexDueAssetRow[] = [];

  for (const asset of input.assets) {
    if (!asset.lifecycle_replace_by || !asset.replacement_cost_estimate_cents || asset.replacement_cost_estimate_cents <= 0) continue;
    if (asset.status === "retired") continue;

    const facilityId = asset.facility_id;
    const facility = scopeMap.get(facilityId);
    const snapshot = facilityRows.get(facilityId) ?? {
      overdueCount: 0,
      overdueCostCents: 0,
      due12MonthsCount: 0,
      due12MonthsCostCents: 0,
      due36MonthsCount: 0,
      due36MonthsCostCents: 0,
    };

    const dueDate = new Date(asset.lifecycle_replace_by);
    const dayDiff = (dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24);
    if (dayDiff < 0) {
      snapshot.overdueCount += 1;
      snapshot.overdueCostCents += asset.replacement_cost_estimate_cents;
    } else if (dayDiff <= 365) {
      snapshot.due12MonthsCount += 1;
      snapshot.due12MonthsCostCents += asset.replacement_cost_estimate_cents;
    } else if (dayDiff <= 365 * 3) {
      snapshot.due36MonthsCount += 1;
      snapshot.due36MonthsCostCents += asset.replacement_cost_estimate_cents;
    } else {
      continue;
    }

    facilityRows.set(facilityId, snapshot);
    dueSoon.push({
      id: asset.id,
      facilityId,
      facilityName: facility?.facilityName ?? facilityId,
      assetType: asset.asset_type,
      assetName: asset.name,
      status: asset.status,
      dueDate: asset.lifecycle_replace_by,
      replacementCostCents: asset.replacement_cost_estimate_cents,
      monthsFromNow: monthsFromNow(asset.lifecycle_replace_by, today),
    });
  }

  const rows = Array.from(new Set<string>([...input.facilities.map((facility) => facility.id), ...facilityRows.keys()]))
    .map((facilityId) => {
      const facility = scopeMap.get(facilityId);
      const snapshot = facilityRows.get(facilityId) ?? {
        overdueCount: 0,
        overdueCostCents: 0,
        due12MonthsCount: 0,
        due12MonthsCostCents: 0,
        due36MonthsCount: 0,
        due36MonthsCostCents: 0,
      };
      return {
        facilityId,
        facilityName: facility?.facilityName ?? facilityId,
        ...snapshot,
      } satisfies CapexFacilityRow;
    })
    .sort((left, right) => right.due12MonthsCostCents + right.overdueCostCents - (left.due12MonthsCostCents + left.overdueCostCents));

  return {
    summary: {
      overdueCount: sumNumbers(rows.map((row) => row.overdueCount)),
      overdueCostCents: sumNumbers(rows.map((row) => row.overdueCostCents)),
      due12MonthsCount: sumNumbers(rows.map((row) => row.due12MonthsCount)),
      due12MonthsCostCents: sumNumbers(rows.map((row) => row.due12MonthsCostCents)),
      due36MonthsCount: sumNumbers(rows.map((row) => row.due36MonthsCount)),
      due36MonthsCostCents: sumNumbers(rows.map((row) => row.due36MonthsCostCents)),
    },
    rows,
    dueSoon: dueSoon
      .sort((left, right) => {
        if (left.dueDate === right.dueDate) return right.replacementCostCents - left.replacementCostCents;
        return left.dueDate.localeCompare(right.dueDate);
      })
      .slice(0, 8),
  };
}
