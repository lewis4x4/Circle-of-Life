"use client";

import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFacilityCommunicationSettings } from "@/hooks/useFacilityCommunicationSettings";
import type { CommunicationSettingsInput } from "@/lib/validation/facility-admin";

interface CommunicationTabProps {
  facilityId: string;
}

function timeVal(v: unknown): string {
  if (typeof v !== "string") return "09:00";
  return v.length >= 5 ? v.slice(0, 5) : v;
}

function settingsToBase(settings: Record<string, unknown> | null): Partial<CommunicationSettingsInput> {
  if (!settings) return {};
  const s = settings;
  return {
    visiting_hours_start: timeVal(s.visiting_hours_start),
    visiting_hours_end: timeVal(s.visiting_hours_end),
    visitor_check_in_required: Boolean(s.visitor_check_in_required),
    visitor_screening_enabled: Boolean(s.visitor_screening_enabled),
    restricted_areas: (s.restricted_areas as string[]) ?? [],
    auto_notify_incident_types: (s.auto_notify_incident_types as string[]) ?? [],
    care_plan_update_notifications: Boolean(s.care_plan_update_notifications),
    photo_sharing_enabled: Boolean(s.photo_sharing_enabled),
    message_approval_required: Boolean(s.message_approval_required),
    google_business_profile_url: (s.google_business_profile_url as string) ?? undefined,
    yelp_listing_url: (s.yelp_listing_url as string) ?? undefined,
    caring_com_profile_url: (s.caring_com_profile_url as string) ?? undefined,
    facebook_page_url: (s.facebook_page_url as string) ?? undefined,
    facility_tagline: (s.facility_tagline as string) ?? undefined,
    tour_available_hours_start: s.tour_available_hours_start
      ? timeVal(s.tour_available_hours_start)
      : undefined,
    tour_available_hours_end: s.tour_available_hours_end
      ? timeVal(s.tour_available_hours_end)
      : undefined,
  };
}

export function CommunicationTab({ facilityId }: CommunicationTabProps) {
  const { settings, capabilities, isLoading, error, saveSettings, isSaving } =
    useFacilityCommunicationSettings(facilityId);
  const base = useMemo(
    () => settingsToBase(settings as Record<string, unknown> | null),
    [settings],
  );
  const [draft, setDraft] = useState<Partial<CommunicationSettingsInput>>({});
  const merged = { ...base, ...draft };

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const payload: Record<string, unknown> = { ...merged };
    for (const k of Object.keys(payload)) {
      const v = payload[k];
      if (v === "" || v === undefined) delete payload[k];
    }
    if (!capabilities?.can_edit_marketing) {
      delete payload.google_business_profile_url;
      delete payload.yelp_listing_url;
      delete payload.caring_com_profile_url;
      delete payload.facebook_page_url;
      delete payload.facility_tagline;
      delete payload.tour_available_hours_start;
      delete payload.tour_available_hours_end;
      delete payload.key_differentiators;
      delete payload.tour_available_days;
    }
    await saveSettings(payload as CommunicationSettingsInput);
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  const canMarketing = capabilities?.can_edit_marketing ?? false;

  return (
    <form onSubmit={onSave} className="space-y-8">
      <section className="rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-6 sm:p-8 space-y-4 shadow-sm backdrop-blur-2xl">
        <h3 className="font-semibold">Visitation</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Start
            <input
              type="time"
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.visiting_hours_start ?? "09:00"}
              onChange={(e) => setDraft((d) => ({ ...d, visiting_hours_start: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            End
            <input
              type="time"
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.visiting_hours_end ?? "20:00"}
              onChange={(e) => setDraft((d) => ({ ...d, visiting_hours_end: e.target.value }))}
            />
          </label>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={merged.visitor_check_in_required ?? true}
            onChange={(e) => setDraft((d) => ({ ...d, visitor_check_in_required: e.target.checked }))}
          />
          Visitor check-in required
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={merged.visitor_screening_enabled ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, visitor_screening_enabled: e.target.checked }))}
          />
          Illness / screening rules enabled
        </label>
      </section>

      <section className="rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-6 sm:p-8 space-y-4 shadow-sm backdrop-blur-2xl">
        <h3 className="font-semibold">Family notifications</h3>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={merged.care_plan_update_notifications ?? true}
            onChange={(e) => setDraft((d) => ({ ...d, care_plan_update_notifications: e.target.checked }))}
          />
          Care plan update notifications
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={merged.photo_sharing_enabled ?? true}
            onChange={(e) => setDraft((d) => ({ ...d, photo_sharing_enabled: e.target.checked }))}
          />
          Photo sharing enabled
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={merged.message_approval_required ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, message_approval_required: e.target.checked }))}
          />
          Message approval required
        </label>
      </section>

      {canMarketing && (
        <section className="rounded-[2rem] border border-slate-200/50 dark:border-white/5 bg-white/40 dark:bg-black/20 p-6 sm:p-8 space-y-4 shadow-sm backdrop-blur-2xl">
          <h3 className="font-semibold">Online presence (owner / org_admin)</h3>
          <label className="text-sm block">
            Google Business Profile URL
            <input
              type="url"
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.google_business_profile_url ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, google_business_profile_url: e.target.value }))}
            />
          </label>
          <label className="text-sm block">
            Yelp
            <input
              type="url"
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.yelp_listing_url ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, yelp_listing_url: e.target.value }))}
            />
          </label>
          <label className="text-sm block">
            Tagline
            <input
              className="mt-1 w-full rounded border px-2 py-2"
              value={merged.facility_tagline ?? ""}
              onChange={(e) => setDraft((d) => ({ ...d, facility_tagline: e.target.value }))}
            />
          </label>
        </section>
      )}

      {!capabilities?.can_edit && (
        <p className="text-sm text-slate-500 dark:text-slate-400">You do not have permission to edit communication settings.</p>
      )}

      {capabilities?.can_edit && (
        <button
          type="submit"
          disabled={isSaving}
          className="rounded-[1.5rem] bg-teal-600 px-6 py-2 text-white disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save communication settings"}
        </button>
      )}
    </form>
  );
}
