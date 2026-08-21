"use client";

import React, { useMemo, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { FacilityDetailRow } from "@/types/facility";
import type { BuildingProfileInput } from "@/lib/validation/facility-admin";
import {
  CONSTRUCTION_TYPES,
  FIRE_SUPPRESSION_TYPES,
  GENERATOR_FUEL_TYPES,
} from "@/lib/admin/facilities/facility-constants";
import {
  CONSTRUCTION_TYPE_LABELS,
  FIRE_SUPPRESSION_LABELS,
  GENERATOR_FUEL_LABELS,
} from "@/lib/admin/facilities/building-profile-labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { PhoneLink } from "@/components/common/phone-link";
import {
  BUILDING_TAB_AGGREGATE_AUDIT_FOOTNOTE_COPY,
  BUILDING_TAB_NO_96_HOUR_READINESS_COPY,
  BUILDING_TAB_NO_CEMP_STATUS_COPY,
  BUILDING_TAB_NO_COMMON_AREA_SQFT_COPY,
  BUILDING_TAB_NO_ELOPEMENT_DRILL_COPY,
  BUILDING_TAB_NO_GENERATOR_CIRCUITS_COPY,
  BUILDING_TAB_NO_GENERATOR_MANUFACTURER_COPY,
  BUILDING_TAB_NO_GENERATOR_PM_TECHNICIAN_COPY,
  BUILDING_TAB_NO_GENERATOR_TANK_RUNTIME_COPY,
  BUILDING_TAB_NO_NEXT_SPRINKLER_INSPECTION_COPY,
  BUILDING_TAB_NO_RESIDENT_ROOM_COUNT_COPY,
  BUILDING_TAB_NO_SECTION_AUDIT_TRAIL_COPY,
  BUILDING_TAB_NO_SECURE_UNIT_COPY,
  BUILDING_TAB_NO_SPRINKLER_COVERAGE_COPY,
  BUILDING_TAB_NO_SPRINKLER_INSPECTION_COPY,
  BUILDING_TAB_NO_SPRINKLER_SYSTEM_TYPE_COPY,
  BUILDING_TAB_NO_STORM_HARDENING_COPY,
  BUILDING_TAB_SPRINKLER_DETAIL_FOOTNOTE_COPY,
  buildingTabLicensedBedCountIsMissing,
  formatBuildingTabLicensedBedCount,
} from "@/lib/facilities/building-tab-display-copy";

const ENUM_UNSET = "__unset__";
const CURRENT_YEAR = new Date().getFullYear();

function d(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.length >= 10 ? v.slice(0, 10) : v;
  return String(v);
}

function normalizeVendorSeparators(raw: string): string {
  return raw.trim().replace(/\s*\/\s*/g, " — ");
}

function splitTrailingParen(raw: string): { body: string; tag?: string } {
  const m = raw.trim().match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (!m) return { body: raw.trim() };
  return { body: m[1].trim(), tag: m[2].trim() };
}

function profileToDraft(profile: Record<string, unknown> | null): Partial<BuildingProfileInput> {
  if (!profile) return {};
  const p = profile;
  return {
    year_built: (p.year_built as number) ?? undefined,
    number_of_floors: (p.number_of_floors as number) ?? 1,
    square_footage: (p.square_footage as number) ?? undefined,
    has_generator: Boolean(p.has_generator),
    has_elevator: Boolean(p.has_elevator),
    ada_compliant: Boolean(p.ada_compliant),
    shelter_in_place_capacity_days: (p.shelter_in_place_capacity_days as number) ?? 3,
    construction_type: p.construction_type as BuildingProfileInput["construction_type"],
    fire_suppression_type: p.fire_suppression_type as BuildingProfileInput["fire_suppression_type"],
    fire_alarm_monitoring_company: (p.fire_alarm_monitoring_company as string) ?? undefined,
    electric_provider: (p.electric_provider as string) ?? undefined,
    electric_phone: (p.electric_phone as string) ?? undefined,
    gas_provider: (p.gas_provider as string) ?? undefined,
    gas_phone: (p.gas_phone as string) ?? undefined,
    generator_fuel_type: p.generator_fuel_type as BuildingProfileInput["generator_fuel_type"],
    generator_service_vendor: (p.generator_service_vendor as string) ?? undefined,
    generator_capacity_kw: (p.generator_capacity_kw as number) ?? undefined,
    generator_last_test_date: d(p.generator_last_test_date) || undefined,
    generator_next_service_date: d(p.generator_next_service_date) || undefined,
    kitchen_license_number: (p.kitchen_license_number as string) ?? undefined,
    last_fire_inspection_date: d(p.last_fire_inspection_date) || undefined,
    next_fire_inspection_date: d(p.next_fire_inspection_date) || undefined,
    evacuation_partner_facility: (p.evacuation_partner_facility as string) ?? undefined,
    evacuation_transport_capacity: (p.evacuation_transport_capacity as number) ?? undefined,
    door_alarm_system: (p.door_alarm_system as string) ?? undefined,
    perimeter_description: (p.perimeter_description as string) ?? undefined,
    wander_guard_system: (p.wander_guard_system as string) ?? undefined,
  };
}

function mergedPayload(m: Partial<BuildingProfileInput>): BuildingProfileInput {
  return Object.fromEntries(
    Object.entries(m).filter(([, v]) => v !== undefined && v !== ""),
  ) as BuildingProfileInput;
}

function sprinklerCoverageSentence(v: BuildingProfileInput["fire_suppression_type"]): string {
  switch (v) {
    case "full_sprinkler":
      return "Inferred coverage: Full (matches suppression profile).";
    case "partial_sprinkler":
      return "Inferred coverage: Partial (matches suppression profile).";
    case "extinguisher_only":
      return "Inferred coverage: None — portable extinguishers only on file.";
    case "none":
      return "Inferred coverage: None on file.";
    default:
      return "Select suppression above to infer baseline sprinkler coverage.";
  }
}

function SectionAuditFooter({ updatedAt }: { updatedAt?: string | null }) {
  if (!updatedAt || typeof updatedAt !== "string") {
    return (
      <p className="mt-4 text-[12px] text-muted-foreground">{BUILDING_TAB_NO_SECTION_AUDIT_TRAIL_COPY}</p>
    );
  }
  const iso = new Date(updatedAt).toISOString();
  return (
    <p className="mt-4 text-[12px] text-muted-foreground">
      Last saved {iso.replace(".000Z", "Z")} · {BUILDING_TAB_AGGREGATE_AUDIT_FOOTNOTE_COPY}
    </p>
  );
}

function BuildingSection({
  title,
  children,
  auditUpdatedAt,
}: {
  title: string;
  children: React.ReactNode;
  auditUpdatedAt?: string | null;
}) {
  return (
    <section className="pb-8">
      <h2 className="text-[14px] font-semibold tracking-tight text-foreground">{title}</h2>
      <div className="mt-2 border-t border-border" />
      <div className="mt-4">{children}</div>
      <SectionAuditFooter updatedAt={auditUpdatedAt} />
    </section>
  );
}

function ScaffoldRow({ label, valueCopy }: { label: string; valueCopy: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 py-2 last:border-b-0">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm text-muted-foreground">{valueCopy}</span>
    </div>
  );
}

const inputCls =
  "mt-1 w-full rounded-[8px] border border-border bg-background px-2 py-2 text-sm text-foreground shadow-none focus:outline-none focus:ring-2 focus:ring-ring";

interface BuildingTabProps {
  facilityId: string;
  facility: FacilityDetailRow;
  profile: Record<string, unknown> | null;
  isLoading: boolean;
  error: string | null;
  saveProfile: (p: BuildingProfileInput) => Promise<void>;
  isSaving: boolean;
}

export function BuildingTab({
  facilityId,
  facility,
  profile,
  isLoading,
  error,
  saveProfile,
  isSaving,
}: BuildingTabProps) {
  const baseDraft = useMemo(() => profileToDraft(profile), [profile]);
  const [draft, setDraft] = useState<Partial<BuildingProfileInput>>({});
  const [dirty, setDirty] = useState(false);

  const merged = useMemo(() => ({ ...baseDraft, ...draft }), [baseDraft, draft]);
  const auditStamp = typeof profile?.updated_at === "string" ? profile.updated_at : null;

  const docsHref = `/admin/facilities/${facilityId}?tab=documents`;
  const vendorsHref = `/admin/facilities/${facilityId}?tab=vendors`;
  const licensingHref = `/admin/facilities/${facilityId}?tab=licensing`;

  function touchDraft(updater: (prev: Partial<BuildingProfileInput>) => Partial<BuildingProfileInput>) {
    setDraft((prev) => updater(prev));
    setDirty(true);
  }

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    try {
      await saveProfile(mergedPayload(merged));
      toast.success("Building profile saved.");
    } catch {
      toast.error("Could not save building profile.");
    }
  }

  function onDiscard() {
    const keys = Object.keys(draft);
    if (keys.length > 5 && typeof window !== "undefined") {
      const ok = window.confirm(`Discard ${keys.length} unsaved edits on this page?`);
      if (!ok) return;
    }
    setDraft({});
    setDirty(false);
  }

  const gasParts = splitTrailingParen(merged.gas_provider ?? "");

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <form
      key={`${facilityId}:${String(profile?.updated_at ?? "")}`}
      onSubmit={onSave}
      className={cn("relative pb-24", dirty && "pb-28")}
    >
      <BuildingSection title="Construction" auditUpdatedAt={auditStamp}>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-foreground">
            Year built
            <input
              type="number"
              min={1900}
              max={CURRENT_YEAR}
              step={1}
              className={inputCls}
              value={merged.year_built ?? ""}
              placeholder=""
              onChange={(e) =>
                touchDraft((d) => ({
                  ...d,
                  year_built: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
            />
          </label>
          <label className="text-sm text-foreground">
            Floors
            <input
              type="number"
              min={1}
              max={10}
              step={1}
              className={inputCls}
              value={merged.number_of_floors ?? 1}
              onChange={(e) =>
                touchDraft((d) => ({
                  ...d,
                  number_of_floors: Math.min(10, Math.max(1, Number(e.target.value) || 1)),
                }))
              }
            />
          </label>
          <label className="text-sm text-foreground">
            Construction type
            <Select
              value={merged.construction_type ?? ENUM_UNSET}
              onValueChange={(v) =>
                touchDraft((d) => ({
                  ...d,
                  construction_type: v === ENUM_UNSET ? undefined : (v as BuildingProfileInput["construction_type"]),
                }))
              }
            >
              <SelectTrigger className={cn(inputCls, "h-auto py-2")}>
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ENUM_UNSET}>Not set</SelectItem>
                {CONSTRUCTION_TYPES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {CONSTRUCTION_TYPE_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="text-sm text-foreground">
            Square footage (total building)
            <input
              type="number"
              min={0}
              step={1}
              className={inputCls}
              value={merged.square_footage ?? ""}
              placeholder=""
              onChange={(e) =>
                touchDraft((d) => ({
                  ...d,
                  square_footage: e.target.value ? Number(e.target.value) : undefined,
                }))
              }
            />
          </label>
          <div className="text-sm text-foreground">
            <span className="block">Resident rooms (count)</span>
            <p className="mt-3 text-[13px] text-muted-foreground tabular-nums">
              {BUILDING_TAB_NO_RESIDENT_ROOM_COUNT_COPY}
            </p>
          </div>
          <div className="text-sm text-foreground">
            <span className="block">Licensed beds</span>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "text-[13px] tabular-nums",
                  buildingTabLicensedBedCountIsMissing(facility.total_licensed_beds)
                    ? "text-muted-foreground"
                    : "text-foreground",
                )}
              >
                {formatBuildingTabLicensedBedCount(facility.total_licensed_beds)}
              </span>
              <Link href={licensingHref} className="text-[13px] text-primary hover:underline">
                Licensing tab
              </Link>
            </div>
          </div>
          <div className="text-sm text-foreground">
            <span className="block">Common area sq ft</span>
            <p className="mt-3 text-[13px] text-muted-foreground tabular-nums">
              {BUILDING_TAB_NO_COMMON_AREA_SQFT_COPY}
            </p>
          </div>
        </div>
      </BuildingSection>

      <BuildingSection title="Fire & safety" auditUpdatedAt={auditStamp}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-foreground">
            Suppression
            <Select
              value={merged.fire_suppression_type ?? ENUM_UNSET}
              onValueChange={(v) =>
                touchDraft((d) => ({
                  ...d,
                  fire_suppression_type: v === ENUM_UNSET ? undefined : (v as BuildingProfileInput["fire_suppression_type"]),
                }))
              }
            >
              <SelectTrigger className={cn(inputCls, "h-auto py-2")}>
                <SelectValue placeholder="Select suppression" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ENUM_UNSET}>Not set</SelectItem>
                {FIRE_SUPPRESSION_TYPES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {FIRE_SUPPRESSION_LABELS[c]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="text-sm text-foreground">
            Fire alarm monitoring
            <input
              className={inputCls}
              value={merged.fire_alarm_monitoring_company ?? ""}
              placeholder=""
              onChange={(e) => touchDraft((d) => ({ ...d, fire_alarm_monitoring_company: e.target.value }))}
            />
          </label>
          <div className="sm:col-span-2">
            <label className="text-sm text-foreground">
              Last fire inspection
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <DateInput
                  className={cn(inputCls, "mt-0 w-auto min-w-[11rem]")}
                  aria-label="Last fire inspection date"
                  value={merged.last_fire_inspection_date ?? ""}
                  emptyHint={null}
                  onValueChange={(v) =>
                    touchDraft((d) => ({ ...d, last_fire_inspection_date: v || undefined }))
                  }
                />
                {!merged.last_fire_inspection_date ? (
                  <span className="text-xs text-muted-foreground">Not on file</span>
                ) : (
                  <Link href={docsHref} className="text-xs text-primary hover:underline">
                    Proof in Document Vault
                  </Link>
                )}
              </div>
            </label>
          </div>
          <div className="sm:col-span-2">
            <label className="text-sm text-foreground">
              Next fire inspection due
              <div className="mt-1 flex flex-wrap items-center gap-3">
                <DateInput
                  className={cn(inputCls, "mt-0 w-auto min-w-[11rem]")}
                  aria-label="Next fire inspection due date"
                  value={merged.next_fire_inspection_date ?? ""}
                  emptyHint={null}
                  onValueChange={(v) =>
                    touchDraft((d) => ({ ...d, next_fire_inspection_date: v || undefined }))
                  }
                />
                {!merged.next_fire_inspection_date ? (
                  <span className="text-xs text-muted-foreground">Not on file</span>
                ) : null}
              </div>
            </label>
          </div>
        </div>
      </BuildingSection>

      <BuildingSection title="Sprinkler system" auditUpdatedAt={auditStamp}>
        <p className="mb-3 text-[13px] text-muted-foreground">{sprinklerCoverageSentence(merged.fire_suppression_type)}</p>
        <ScaffoldRow
          label="Dedicated coverage selector (full / partial / none)"
          valueCopy={BUILDING_TAB_NO_SPRINKLER_COVERAGE_COPY}
        />
        <ScaffoldRow
          label="System type (wet / dry / pre-action / deluge)"
          valueCopy={BUILDING_TAB_NO_SPRINKLER_SYSTEM_TYPE_COPY}
        />
        <ScaffoldRow
          label="Last sprinkler inspection date + vault link"
          valueCopy={BUILDING_TAB_NO_SPRINKLER_INSPECTION_COPY}
        />
        <ScaffoldRow
          label="Next sprinkler inspection due"
          valueCopy={BUILDING_TAB_NO_NEXT_SPRINKLER_INSPECTION_COPY}
        />
        <p className="mt-2 text-[12px] text-muted-foreground">{BUILDING_TAB_SPRINKLER_DETAIL_FOOTNOTE_COPY}</p>
      </BuildingSection>

      <BuildingSection title="Emergency power / Generator (AHCA Rule 59A-36 framing)" auditUpdatedAt={auditStamp}>
        <div id="facility-building-generator" className="scroll-mt-24">
          <label className="flex items-center gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              checked={merged.has_generator ?? false}
              onChange={(e) => touchDraft((d) => ({ ...d, has_generator: e.target.checked }))}
            />
            Has generator
          </label>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-foreground">
              Fuel type
              <Select
                value={merged.generator_fuel_type ?? ENUM_UNSET}
                onValueChange={(v) =>
                  touchDraft((d) => ({
                    ...d,
                    generator_fuel_type: v === ENUM_UNSET ? undefined : (v as BuildingProfileInput["generator_fuel_type"]),
                  }))
                }
              >
                <SelectTrigger className={cn(inputCls, "h-auto py-2")}>
                  <SelectValue placeholder="Select fuel" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ENUM_UNSET}>Not set</SelectItem>
                  {GENERATOR_FUEL_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {GENERATOR_FUEL_LABELS[c]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="text-sm text-foreground">
              Service vendor
              <input
                className={inputCls}
                value={merged.generator_service_vendor ?? ""}
                placeholder=""
                onChange={(e) => touchDraft((d) => ({ ...d, generator_service_vendor: e.target.value }))}
              />
              <p className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[12px] text-muted-foreground">
                <Link href={vendorsHref} className="text-primary hover:underline">
                  Vendors hub
                </Link>
                {merged.generator_service_vendor ? (
                  <>
                    <span aria-hidden>·</span>
                    <Link href={vendorsHref} className="font-medium text-primary hover:underline">
                      {normalizeVendorSeparators(merged.generator_service_vendor)}
                    </Link>
                  </>
                ) : null}
              </p>
            </label>
            <label className="text-sm text-foreground">
              kW capacity (on file)
              <input
                type="number"
                min={0}
                step={1}
                className={inputCls}
                value={merged.generator_capacity_kw ?? ""}
                placeholder=""
                onChange={(e) =>
                  touchDraft((d) => ({
                    ...d,
                    generator_capacity_kw: e.target.value ? Number(e.target.value) : undefined,
                  }))
                }
              />
            </label>
            <div className="sm:col-span-2 rounded-md border border-border/80 bg-muted/10 px-3 py-2 text-[13px] text-muted-foreground">
              {BUILDING_TAB_NO_96_HOUR_READINESS_COPY}
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm text-foreground">
                Last load test
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <DateInput
                    className={cn(inputCls, "mt-0 w-auto min-w-[11rem]")}
                    aria-label="Generator last load test date"
                    value={merged.generator_last_test_date ?? ""}
                    emptyHint={null}
                    onValueChange={(v) =>
                      touchDraft((d) => ({
                        ...d,
                        generator_last_test_date: v || undefined,
                      }))
                    }
                  />
                  {!merged.generator_last_test_date ? (
                    <span className="text-xs text-muted-foreground">Not on file</span>
                  ) : (
                    <Link href={docsHref} className="text-xs text-primary hover:underline">
                      Proof in Document Vault
                    </Link>
                  )}
                </div>
              </label>
            </div>
            <div className="sm:col-span-2">
              <label className="text-sm text-foreground">
                Next PM / service due
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <DateInput
                    className={cn(inputCls, "mt-0 w-auto min-w-[11rem]")}
                    aria-label="Next generator PM or service due date"
                    value={merged.generator_next_service_date ?? ""}
                    emptyHint={null}
                    onValueChange={(v) =>
                      touchDraft((d) => ({
                        ...d,
                        generator_next_service_date: v || undefined,
                      }))
                    }
                  />
                  {!merged.generator_next_service_date ? (
                    <span className="text-xs text-muted-foreground">Not on file</span>
                  ) : null}
                </div>
              </label>
            </div>
          </div>
          <div className="mt-6 space-y-1">
            <ScaffoldRow
              label="Manufacturer / model (structured)"
              valueCopy={BUILDING_TAB_NO_GENERATOR_MANUFACTURER_COPY}
            />
            <ScaffoldRow
              label="Fuel tank size (gal) · runtime @ full load (hrs)"
              valueCopy={BUILDING_TAB_NO_GENERATOR_TANK_RUNTIME_COPY}
            />
            <ScaffoldRow
              label="Covered circuits selector"
              valueCopy={BUILDING_TAB_NO_GENERATOR_CIRCUITS_COPY}
            />
            <ScaffoldRow
              label="Last PM service technician-of-record"
              valueCopy={BUILDING_TAB_NO_GENERATOR_PM_TECHNICIAN_COPY}
            />
          </div>
        </div>
      </BuildingSection>

      <BuildingSection title="Utilities" auditUpdatedAt={auditStamp}>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-foreground">
            Electric provider
            <input
              className={inputCls}
              value={merged.electric_provider ?? ""}
              placeholder=""
              onChange={(e) => touchDraft((d) => ({ ...d, electric_provider: e.target.value }))}
            />
          </label>
          <label className="text-sm text-foreground">
            <span className="flex items-center gap-2">
              Electric phone
              <PhoneLink phone={merged.electric_phone ?? ""} iconOnly />
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                className={cn(inputCls, "mt-0 flex-1")}
                value={merged.electric_phone ?? ""}
                placeholder=""
                onChange={(e) => touchDraft((d) => ({ ...d, electric_phone: e.target.value }))}
              />
            </div>
          </label>
          <label className="text-sm text-foreground">
            Gas provider
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <input
                className={cn(inputCls, "mt-0 flex-1 min-w-[12rem]")}
                value={merged.gas_provider ?? ""}
                placeholder=""
                onChange={(e) => touchDraft((d) => ({ ...d, gas_provider: e.target.value }))}
              />
              {gasParts.tag ? (
                <Badge variant="secondary" className="font-normal">
                  {gasParts.tag}
                </Badge>
              ) : null}
            </div>
            {gasParts.body && gasParts.tag ? (
              <p className="mt-1 text-[12px] text-muted-foreground">
                Structured hint: provider <span className="text-foreground">{gasParts.body}</span> · fuel note{" "}
                <span className="text-foreground">{gasParts.tag}</span>
              </p>
            ) : null}
          </label>
          <label className="text-sm text-foreground">
            <span className="flex items-center gap-2">
              Gas phone
              <PhoneLink phone={merged.gas_phone ?? ""} iconOnly />
            </span>
            <div className="mt-1 flex items-center gap-2">
              <input
                className={cn(inputCls, "mt-0 flex-1")}
                value={merged.gas_phone ?? ""}
                placeholder=""
                onChange={(e) => touchDraft((d) => ({ ...d, gas_phone: e.target.value }))}
              />
            </div>
          </label>
        </div>
      </BuildingSection>

      <BuildingSection title="Elopement prevention" auditUpdatedAt={auditStamp}>
        <div className="space-y-3">
          <label className="block text-sm text-foreground">
            Door alarm system
            <input
              className={inputCls}
              value={merged.door_alarm_system ?? ""}
              placeholder="e.g. DSC Power 1832 keypad, monitored by Security Safe central station"
              onChange={(e) => touchDraft((d) => ({ ...d, door_alarm_system: e.target.value }))}
            />
          </label>
          <label className="block text-sm text-foreground">
            Wander Guard / tag system
            <input
              className={inputCls}
              value={merged.wander_guard_system ?? ""}
              placeholder=""
              onChange={(e) => touchDraft((d) => ({ ...d, wander_guard_system: e.target.value }))}
            />
          </label>
          <label className="block text-sm text-foreground">
            Perimeter description
            <textarea
              className={inputCls}
              rows={3}
              value={merged.perimeter_description ?? ""}
              placeholder="e.g. Fully fenced rear courtyard; lobby exits tied to keypad egress."
              onChange={(e) => touchDraft((d) => ({ ...d, perimeter_description: e.target.value }))}
            />
          </label>
          <ScaffoldRow label="Secure unit Y/N · secure bed count" valueCopy={BUILDING_TAB_NO_SECURE_UNIT_COPY} />
          <ScaffoldRow label="Last elopement drill · cadence" valueCopy={BUILDING_TAB_NO_ELOPEMENT_DRILL_COPY} />
        </div>
      </BuildingSection>

      <BuildingSection title="Severe weather / storm preparedness" auditUpdatedAt={auditStamp}>
        <p className="mb-3 text-[13px] text-muted-foreground">
          Cross-reference{" "}
          <a href="#facility-building-generator" className="text-primary hover:underline">
            Emergency power / Generator
          </a>{" "}
          for AHCA Rule 59A-36 readiness framing.
        </p>
        <ScaffoldRow
          label="CEMP filed with county OEM · approved · expires"
          valueCopy={BUILDING_TAB_NO_CEMP_STATUS_COPY}
        />
        <div className="py-2">
          <Link href={docsHref} className="text-sm text-primary hover:underline">
            Upload / locate CEMP PDF in Document Vault (storm preparedness category)
          </Link>
        </div>
        <ScaffoldRow
          label="Impact-rated openings · shutter system · evacuation contract vendor"
          valueCopy={BUILDING_TAB_NO_STORM_HARDENING_COPY}
        />
        <label className="mt-4 block text-sm text-foreground">
          Evacuation partner facility
          <input
            className={inputCls}
            value={merged.evacuation_partner_facility ?? ""}
            placeholder=""
            onChange={(e) => touchDraft((d) => ({ ...d, evacuation_partner_facility: e.target.value }))}
          />
        </label>
        <label className="mt-4 block text-sm text-foreground">
          Evacuation transport capacity (residents / trip)
          <input
            type="number"
            min={0}
            step={1}
            className={inputCls}
            value={merged.evacuation_transport_capacity ?? ""}
            placeholder=""
            onChange={(e) =>
              touchDraft((d) => ({
                ...d,
                evacuation_transport_capacity: e.target.value ? Number(e.target.value) : undefined,
              }))
            }
          />
        </label>
        <label className="mt-4 block text-sm text-foreground">
          Shelter-in-place capacity (days on hand)
          <input
            type="number"
            min={1}
            step={1}
            className={inputCls}
            value={merged.shelter_in_place_capacity_days ?? 3}
            onChange={(e) =>
              touchDraft((d) => ({
                ...d,
                shelter_in_place_capacity_days: Number(e.target.value) || 3,
              }))
            }
          />
        </label>
      </BuildingSection>

      {dirty ? (
        <div
          className={cn(
            "fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] backdrop-blur-sm",
            "flex flex-wrap items-center justify-between gap-3 md:px-8",
          )}
        >
          <p className="text-sm text-muted-foreground">Unsaved changes</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onDiscard}>
              Discard
            </Button>
            <Button type="submit" size="sm" disabled={isSaving}>
              {isSaving ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      ) : null}
    </form>
  );
}
