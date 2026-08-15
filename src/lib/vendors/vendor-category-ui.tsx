import { AlertTriangle } from "lucide-react";
import React from "react";

import { VENDOR_CONTRACT_NO_STATUS_COPY } from "@/lib/vendors/contracts-display-copy";

/** Broad label map across historical + planned `vendor_category` enum values */
export const VENDOR_CATEGORY_UI_LABELS: Record<string, string> = {
  maintenance: "Maintenance",
  medical_supply: "Medical supply",
  pharmacy: "Pharmacy",
  food_service: "Food service",
  staffing_agency: "Staffing agency",
  consulting: "Consulting",
  technology: "Technology",
  laundry: "Laundry",
  transportation: "Transportation",
  laboratory: "Laboratory / diagnostics",
  utilities: "Utilities",
  security: "Security",
  resident_transport: "Resident transport",
  medical_transport: "Medical transport",
  medical_waste: "Medical waste hauler",
  hospice: "Hospice partner",
  pest_control: "Pest control",
  medical_director: "Medical Director",
  mobile_lab: "Mobile lab",
  mobile_xray: "Mobile imaging",
  podiatry: "Podiatry",
  dental: "Dental services",
  chaplain: "Chaplaincy",
  housekeeping: "Housekeeping",
  lawn: "Grounds / lawn",
  hvac: "HVAC",
  plumbing: "Plumbing",
  sprinkler: "Sprinkler service",
  generator: "Generator service",
  fire_alarm: "Fire alarm monitoring",
  elevator: "Elevator service",
  government_partner: "Government partner",
  community_partner: "Community partner",
  other: "Other",
};

const INFER_OVERRIDES: { test: RegExp; category: keyof typeof VENDOR_CATEGORY_UI_LABELS | string }[] = [
  { test: /\bsuwannee\s+river\s+economic\s+council\b/i, category: "community_partner" },
  { test: /\blafayette\s+county\b/i, category: "government_partner" },
];

/** Display classifier for UI-only overrides before DB backfill catches up */
export function effectiveVendorCategoryKey(category: string | null | undefined, vendorName?: string | null): string {
  const n = (vendorName ?? "").trim().toLowerCase();
  const base = typeof category === "string" ? category.trim() : "";
  const hit = INFER_OVERRIDES.find((h) => h.test.test(vendorName ?? "") || (n && h.test.test(n)));
  if (hit) return hit.category;
  return base || "other";
}

export function formatVendorCategoryLabel(category: string | null | undefined, vendorName?: string | null): string {
  const key = effectiveVendorCategoryKey(category, vendorName);
  return VENDOR_CATEGORY_UI_LABELS[key] ?? prettifyFallback(key);
}

function prettifyFallback(raw: string): string {
  if (!raw.trim()) return "Other";
  return raw.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function VendorCategoryBadge({
  category,
  vendorName,
}: {
  category: string | null | undefined;
  vendorName?: string | null;
}) {
  const key = effectiveVendorCategoryKey(category, vendorName);
  const label = VENDOR_CATEGORY_UI_LABELS[key] ?? prettifyFallback(key);
  return (
    <span className="inline-flex items-center gap-1 text-[13px] text-muted-foreground">
      {key === "other" ? (
        <AlertTriangle className="size-3 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
      ) : null}
      <span className={key === "other" ? "text-amber-800 dark:text-amber-100" : undefined}>{label}</span>
    </span>
  );
}

export type VendorOperationalStatusUi = {
  canonical: boolean;
};

export function vendorStatusUiLabel(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (s) {
    case "active":
      return "Active";
    case "inactive":
      return "Inactive";
    case "draft":
      return "Draft";
    case "blocked":
      return "Blocked";
    case "launch_imported":
    case "":
      return "Imported";
    default:
      return prettifyFallback(s);
  }
}

export function vendorContractUiLabel(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  switch (s) {
    case "active":
      return "Active";
    case "no_contract":
      return "No contract";
    case "expired":
      return "Expired";
    case "partnership":
      return "Partnership";
    case "na":
      return "N/A";
    case "":
      return VENDOR_CONTRACT_NO_STATUS_COPY;
    default:
      return prettifyFallback(s);
  }
}

export type CoiUiTone = "ok" | "warn" | "expired" | "na";

export function coiTone(args: {
  applies: boolean;
  onFile?: boolean | null;
  expiresOn?: string | null;
  now?: Date;
}): { tone: CoiUiTone; label: string } {
  const now = args.now ?? new Date();
  if (!args.applies) return { tone: "na", label: "N/A" };
  if (args.onFile === false) return { tone: "warn", label: "Not on file" };
  const exp = args.expiresOn?.trim();
  if (!exp) return { tone: "warn", label: "⚠ Scheduled · date missing" };
  const deadline = new Date(`${exp}T12:00:00.000Z`);
  const days = Math.floor((deadline.getTime() - now.getTime()) / 86400000);
  if (days < 0) return { tone: "expired", label: `⚠ Expired ${exp}` };
  const flag = days < 60 ? "⚠" : "✓";
  const tone = days < 60 ? "warn" : "ok";
  return {
    tone,
    label: `${flag} to ${deadline.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      timeZone: "America/New_York",
    })}`,
  };
}
