import { THRESHOLD_TYPE_LABELS } from "@/lib/admin/facilities/facility-constants";
import { getThresholdMeta } from "@/lib/admin/facilities/operational-threshold-catalog";
import type { FacilityDetailRow } from "@/types/facility";
import type { ThresholdRow } from "@/hooks/useFacilityThresholds";

export type PreviewSeverity = "yellow" | "red";

export type OperationalPreviewLine = {
  threshold_type: string;
  label: string;
  severity: PreviewSeverity;
  current: string;
};

function occupancyPctWhole(facility: FacilityDetailRow): number | null {
  const raw = facility.occupancy_pct ?? facility.current_occupancy;
  if (raw == null || !Number.isFinite(Number(raw))) return null;
  let v = Number(raw);
  if (v <= 1) v *= 100;
  return v;
}

function daysBetweenToday(isoDate: string): number | null {
  const t = Date.parse(`${isoDate}T12:00:00.000Z`);
  if (Number.isNaN(t)) return null;
  const now = Date.now();
  return Math.ceil((t - now) / 86400000);
}

/** Best-effort evaluator: only types with enough facility context are surfaced. */
export function buildOperationalThresholdPreview(
  facility: FacilityDetailRow | null,
  rows: readonly ThresholdRow[],
): OperationalPreviewLine[] {
  if (!facility) return [];
  const byType = new Map(rows.map((r) => [r.threshold_type, r]));
  const lines: OperationalPreviewLine[] = [];

  const occ = occupancyPctWhole(facility);
  if (occ != null) {
    const low = byType.get("occupancy_low_pct");
    if (low?.enabled && occ < low.red_threshold) {
      lines.push({
        threshold_type: "occupancy_low_pct",
        label: THRESHOLD_TYPE_LABELS.occupancy_low_pct,
        severity: "red",
        current: `${occ.toFixed(1)}% occupancy`,
      });
    } else if (low?.enabled && occ < low.yellow_threshold) {
      lines.push({
        threshold_type: "occupancy_low_pct",
        label: THRESHOLD_TYPE_LABELS.occupancy_low_pct,
        severity: "yellow",
        current: `${occ.toFixed(1)}% occupancy`,
      });
    }

    const high = byType.get("occupancy_high_pct");
    if (high?.enabled && occ > high.red_threshold) {
      lines.push({
        threshold_type: "occupancy_high_pct",
        label: THRESHOLD_TYPE_LABELS.occupancy_high_pct,
        severity: "red",
        current: `${occ.toFixed(1)}% occupancy`,
      });
    } else if (high?.enabled && occ > high.yellow_threshold) {
      lines.push({
        threshold_type: "occupancy_high_pct",
        label: THRESHOLD_TYPE_LABELS.occupancy_high_pct,
        severity: "yellow",
        current: `${occ.toFixed(1)}% occupancy`,
      });
    }
  }

  const lic = facility.ahca_license_expiration;
  if (lic) {
    const rem = daysBetweenToday(lic);
    const row = byType.get("license_expiry_days");
    if (rem != null && row?.enabled) {
      if (rem <= row.red_threshold) {
        lines.push({
          threshold_type: "license_expiry_days",
          label: THRESHOLD_TYPE_LABELS.license_expiry_days,
          severity: "red",
          current: `${rem} days to license expiry`,
        });
      } else if (rem <= row.yellow_threshold) {
        lines.push({
          threshold_type: "license_expiry_days",
          label: THRESHOLD_TYPE_LABELS.license_expiry_days,
          severity: "yellow",
          current: `${rem} days to license expiry`,
        });
      }
    }
  }

  return lines;
}

export function countPreviewFiring(lines: OperationalPreviewLine[]): { red: number; yellow: number } {
  let red = 0;
  let yellow = 0;
  for (const l of lines) {
    if (l.severity === "red") red += 1;
    else yellow += 1;
  }
  return { red, yellow };
}

export type OrgDefaultRow = {
  threshold_type: string;
  yellow_threshold: number;
  red_threshold: number;
  notify_roles: string[];
  alert_frequency?: string | null;
};

export function thresholdsMatchOrgDefault(
  row: Pick<ThresholdRow, "threshold_type" | "yellow_threshold" | "red_threshold" | "notify_roles" | "enabled">,
  org: OrgDefaultRow | undefined,
): boolean {
  if (!org) return false;
  if (row.threshold_type !== org.threshold_type) return false;
  return (
    Number(row.yellow_threshold) === Number(org.yellow_threshold) &&
    Number(row.red_threshold) === Number(org.red_threshold) &&
    JSON.stringify([...(row.notify_roles ?? [])].sort()) === JSON.stringify([...(org.notify_roles ?? [])].sort())
  );
}

/** Count how many rows differ from org defaults on yellow/red. */
export function countFacilityThresholdOverrides(
  rows: readonly ThresholdRow[],
  orgDefaults: readonly OrgDefaultRow[],
): number {
  const orgMap = new Map(orgDefaults.map((o) => [o.threshold_type, o]));
  let n = 0;
  for (const r of rows) {
    const o = orgMap.get(r.threshold_type);
    if (!o) continue;
    if (
      Number(r.yellow_threshold) !== Number(o.yellow_threshold) ||
      Number(r.red_threshold) !== Number(o.red_threshold)
    ) {
      n += 1;
    }
  }
  return n;
}

const FREQUENCY_LABELS: Record<string, string> = {
  once_on_breach: "Once on breach",
  daily_until_resolved: "Daily until resolved",
  hourly: "Hourly digest",
  custom: "Custom",
};

export function describeAlertFrequency(thresholdType: string, persisted?: string | null): string {
  const key = persisted?.trim() || getThresholdMeta(thresholdType)?.alertFrequency;
  if (!key) return "";
  return FREQUENCY_LABELS[key] ?? "Custom";
}
