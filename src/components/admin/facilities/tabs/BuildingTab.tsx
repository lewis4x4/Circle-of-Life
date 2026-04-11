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
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }

  return (
    <form onSubmit={onSave} className="space-y-8">
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="font-semibold">Construction</h3>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            Year built
            <input
              type="number"
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.year_built ?? ""}
              onChange={(e) =>
                setDraft((d) => ({ ...d, year_built: e.target.value ? Number(e.target.value) : undefined }))
              }
            />
          </label>
          <label className="text-sm">
            Floors
            <input
              type="number"
              min={1}
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.number_of_floors ?? 1}
              onChange={(e) => setDraft((d) => ({ ...d, number_of_floors: Number(e.target.value) || 1 }))}
            />
          </label>
          <label className="text-sm">
            Construction
            <select
              className="mt-1 w-full rounded border px-2 py-2"
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
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="font-semibold">Fire & safety</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Suppression
            <select
              className="mt-1 w-full rounded border px-2 py-2"
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
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Fire alarm monitoring
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.fire_alarm_monitoring_company ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, fire_alarm_monitoring_company: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Last fire inspection
            <input
              type="date"
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.last_fire_inspection_date ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, last_fire_inspection_date: e.target.value || undefined }))}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="font-semibold">Generator</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={merged.has_generator ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, has_generator: e.target.checked }))}
          />
          Has generator
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Fuel
            <select
              className="mt-1 w-full rounded border px-2 py-2"
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
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            Service vendor
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.generator_service_vendor ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, generator_service_vendor: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="font-semibold">Utilities (building profile)</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Electric provider
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.electric_provider ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, electric_provider: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Electric phone
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.electric_phone ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, electric_phone: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Gas provider
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.gas_provider ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, gas_provider: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            Gas phone
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.gas_phone ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, gas_phone: e.target.value }))}
            />
          </label>
        </div>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="font-semibold">Elopement / storm</h3>
        <label className="text-sm block">
          Door alarm system
          <input
            className="mt-1 w-full rounded border px-2 py-2"
            value={merged.door_alarm_system ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, door_alarm_system: e.target.value }))}
          />
        </label>
        <label className="text-sm block">
          Perimeter description
          <textarea
            className="mt-1 w-full rounded border px-2 py-2"
            rows={2}
            value={merged.perimeter_description ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, perimeter_description: e.target.value }))}
          />
        </label>
        <label className="text-sm block">
          Evacuation partner facility
          <input
            className="mt-1 w-full rounded border px-2 py-2"
            value={merged.evacuation_partner_facility ?? ""}
            onChange={(e) => setDraft((d) => ({ ...d, evacuation_partner_facility: e.target.value }))}
          />
        </label>
      </section>

      <button
        type="submit"
        disabled={isSaving}
        className="rounded-lg bg-teal-600 px-6 py-2 text-white disabled:opacity-50"
      >
        {isSaving ? "Saving…" : "Save building profile"}
      </button>
    </form>
  );
}
