"use client";

import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFacilityBuildingProfile } from "@/hooks/useFacilityBuildingProfile";
import {
  CONSTRUCTION_TYPES,
  FIRE_SUPPRESSION_TYPES,
  GENERATOR_FUEL_TYPES,
} from "@/lib/admin/facilities/facility-constants";
import type { BuildingProfileInput } from "@/lib/validation/facility-admin";
import { RecordDetailSection } from "@/design-system/components/record-detail";

interface BuildingTabProps {
  facilityId: string;
}

function d(v: unknown): string {
  if (v == null || v === "") return "";
  if (typeof v === "string") return v.length >= 10 ? v.slice(0, 10) : v;
  return String(v);
}

function profileToDraft(profile: Record<string, unknown> | null): Partial<BuildingProfileInput> {
  if (!profile) return {};
  const p = profile;
  return {
    year_built: (p.year_built as number) ?? undefined,
    number_of_floors: (p.number_of_floors as number) ?? 1,
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
    kitchen_license_number: (p.kitchen_license_number as string) ?? undefined,
    last_fire_inspection_date: d(p.last_fire_inspection_date) || undefined,
    evacuation_partner_facility: (p.evacuation_partner_facility as string) ?? undefined,
    door_alarm_system: (p.door_alarm_system as string) ?? undefined,
    perimeter_description: (p.perimeter_description as string) ?? undefined,
  };
}

const inputCls = "mt-1 w-full rounded-[8px] border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

export function BuildingTab({ facilityId }: BuildingTabProps) {
  const { profile, isLoading, error, saveProfile, isSaving } = useFacilityBuildingProfile(facilityId);
  const baseDraft = useMemo(
    () => profileToDraft(profile as Record<string, unknown> | null),
    [profile],
  );
  const [draft, setDraft] = useState<Partial<BuildingProfileInput>>({});
  const merged = { ...baseDraft, ...draft };

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const parsed = Object.fromEntries(
      Object.entries(merged).filter(([, v]) => v !== undefined && v !== ""),
    ) as BuildingProfileInput;
    await saveProfile(parsed);
  }

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
    <form onSubmit={onSave} className="space-y-4">
      <RecordDetailSection title="Construction">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm text-foreground">
            Year built
            <input
              type="number"
              className={inputCls}
              value={merged.year_built ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, year_built: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
          </label>
          <label className="text-sm text-foreground">
            Floors
            <input
              type="number"
              min={1}
              className={inputCls}
              value={merged.number_of_floors ?? 1}
              onChange={(e) => setDraft((d) => ({ ...d, number_of_floors: Number(e.target.value) || 1 }))}
            />
          </label>
          <label className="text-sm text-foreground">
            Construction type
            <select
              className={inputCls}
              value={merged.construction_type ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  construction_type: e.target.value
                    ? (e.target.value as BuildingProfileInput["construction_type"])
                    : undefined,
                }))
              }
            >
              <option value="">—</option>
              {CONSTRUCTION_TYPES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
        </div>
      </RecordDetailSection>

      <RecordDetailSection title="Fire &amp; safety">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-foreground">
            Suppression
            <select
              className={inputCls}
              value={merged.fire_suppression_type ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  fire_suppression_type: e.target.value
                    ? (e.target.value as BuildingProfileInput["fire_suppression_type"])
                    : undefined,
                }))
              }
            >
              <option value="">—</option>
              {FIRE_SUPPRESSION_TYPES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-foreground">
            Fire alarm monitoring
            <input
              className={inputCls}
              value={merged.fire_alarm_monitoring_company ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, fire_alarm_monitoring_company: e.target.value }))}
            />
          </label>
          <label className="text-sm text-foreground">
            Last fire inspection
            <input
              type="date"
              className={inputCls}
              value={merged.last_fire_inspection_date ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, last_fire_inspection_date: e.target.value || undefined }))}
            />
          </label>
        </div>
      </RecordDetailSection>

      <RecordDetailSection title="Generator">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={merged.has_generator ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, has_generator: e.target.checked }))}
          />
          Has generator
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-foreground">
            Fuel type
            <select
              className={inputCls}
              value={merged.generator_fuel_type ?? ""}
              onChange={(e) =>
                setDraft((d) => ({
                  ...d,
                  generator_fuel_type: e.target.value
                    ? (e.target.value as BuildingProfileInput["generator_fuel_type"])
                    : undefined,
                }))
              }
            >
              <option value="">—</option>
              {GENERATOR_FUEL_TYPES.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </label>
          <label className="text-sm text-foreground">
            Service vendor
            <input
              className={inputCls}
              value={merged.generator_service_vendor ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, generator_service_vendor: e.target.value }))}
            />
          </label>
        </div>
      </RecordDetailSection>

      <RecordDetailSection title="Utilities">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-foreground">
            Electric provider
            <input
              className={inputCls}
              value={merged.electric_provider ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, electric_provider: e.target.value }))}
            />
          </label>
          <label className="text-sm text-foreground">
            Electric phone
            <input
              className={inputCls}
              value={merged.electric_phone ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, electric_phone: e.target.value }))}
            />
          </label>
          <label className="text-sm text-foreground">
            Gas provider
            <input
              className={inputCls}
              value={merged.gas_provider ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, gas_provider: e.target.value }))}
            />
          </label>
          <label className="text-sm text-foreground">
            Gas phone
            <input
              className={inputCls}
              value={merged.gas_phone ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, gas_phone: e.target.value }))}
            />
          </label>
        </div>
      </RecordDetailSection>

      <RecordDetailSection title="Elopement / storm">
        <div className="space-y-3">
          <label className="text-sm text-foreground block">
            Door alarm system
            <input
              className={inputCls}
              value={merged.door_alarm_system ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, door_alarm_system: e.target.value }))}
            />
          </label>
          <label className="text-sm text-foreground block">
            Perimeter description
            <textarea
              className={inputCls}
              rows={2}
              value={merged.perimeter_description ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, perimeter_description: e.target.value }))}
            />
          </label>
          <label className="text-sm text-foreground block">
            Evacuation partner facility
            <input
              className={inputCls}
              value={merged.evacuation_partner_facility ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, evacuation_partner_facility: e.target.value }))}
            />
          </label>
        </div>
      </RecordDetailSection>

      <button
        type="submit"
        disabled={isSaving}
        className="rounded-[8px] bg-primary px-6 py-2 text-sm text-primary-foreground disabled:opacity-50"
      >
        {isSaving ? "Saving…" : "Save building profile"}
      </button>
    </form>
  );
}
