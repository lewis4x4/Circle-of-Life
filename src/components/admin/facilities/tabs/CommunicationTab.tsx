"use client";

import React, { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { useFacilityCommunicationSettings } from "@/hooks/useFacilityCommunicationSettings";
import type { CommunicationSettingsInput } from "@/lib/validation/facility-admin";
import { RecordDetailSection } from "@/design-system/components/record-detail";

interface CommunicationTabProps {
  facilityId: string;
  /** When omitted, the tab loads settings itself (e.g. isolated tests). Prefer passing from the facility page to share fetch with FacilityHeader KPIs. */
  communicationApi?: ReturnType<typeof useFacilityCommunicationSettings>;
}

function timeVal(v: unknown): string {
  if (typeof v !== "string") return "09:00";
  return v.length >= 5 ? v.slice(0, 5) : v;
}

function parseMinutes(hm: string): number {
  const [h, m] = hm.split(":").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(h) || !Number.isFinite(m)) return NaN;
  return h * 60 + m;
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

const inputCls =
  "mt-1 w-full rounded-[8px] border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-70";

export function CommunicationTab({ facilityId, communicationApi }: CommunicationTabProps) {
  const fallbackApi = useFacilityCommunicationSettings(facilityId, communicationApi === undefined);
  const { settings, capabilities, isLoading, error, saveSettings, isSaving } =
    communicationApi ?? fallbackApi;
  const base = useMemo(
    () => settingsToBase(settings as Record<string, unknown> | null),
    [settings],
  );
  const [draft, setDraft] = useState<Partial<CommunicationSettingsInput>>({});
  const [hoursError, setHoursError] = useState<string | null>(null);
  const merged = { ...base, ...draft };

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    const sm = parseMinutes(merged.visiting_hours_start ?? "09:00");
    const em = parseMinutes(merged.visiting_hours_end ?? "20:00");
    if (Number.isFinite(sm) && Number.isFinite(em) && sm >= em) {
      setHoursError("Visiting hours: start must be before end.");
      return;
    }
    setHoursError(null);

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
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  const canEdit = capabilities?.can_edit ?? false;
  const canMarketing = capabilities?.can_edit_marketing ?? false;
  const showOnlineEditable = canMarketing;
  const showOnlineReadOnly = canEdit && !canMarketing;

  return (
    <form onSubmit={onSave} className="space-y-4">
      <RecordDetailSection title="Visitation">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm text-foreground">
            Start
            <input
              type="time"
              className={inputCls}
              disabled={!canEdit}
              value={merged.visiting_hours_start ?? "09:00"}
              onChange={(e) => {
                setHoursError(null);
                setDraft((d) => ({ ...d, visiting_hours_start: e.target.value }));
              }}
            />
          </label>
          <label className="text-sm text-foreground">
            End
            <input
              type="time"
              className={inputCls}
              disabled={!canEdit}
              value={merged.visiting_hours_end ?? "20:00"}
              onChange={(e) => {
                setHoursError(null);
                setDraft((d) => ({ ...d, visiting_hours_end: e.target.value }));
              }}
            />
          </label>
        </div>
        {hoursError ? (
          <p className="text-sm text-destructive" role="alert">
            {hoursError}
          </p>
        ) : null}
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={merged.visitor_check_in_required ?? true}
            onChange={(e) => setDraft((d) => ({ ...d, visitor_check_in_required: e.target.checked }))}
          />
          Visitor check-in required
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={merged.visitor_screening_enabled ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, visitor_screening_enabled: e.target.checked }))}
          />
          Illness / screening rules enabled
        </label>
      </RecordDetailSection>

      <RecordDetailSection title="Family notifications">
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={merged.care_plan_update_notifications ?? true}
            onChange={(e) => setDraft((d) => ({ ...d, care_plan_update_notifications: e.target.checked }))}
          />
          Care plan update notifications
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={merged.photo_sharing_enabled ?? true}
            onChange={(e) => setDraft((d) => ({ ...d, photo_sharing_enabled: e.target.checked }))}
          />
          Photo sharing enabled
        </label>
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            disabled={!canEdit}
            checked={merged.message_approval_required ?? false}
            onChange={(e) => setDraft((d) => ({ ...d, message_approval_required: e.target.checked }))}
          />
          Message approval required
        </label>
      </RecordDetailSection>

      {(showOnlineEditable || showOnlineReadOnly) && (
        <RecordDetailSection title="Online presence">
          {showOnlineReadOnly ? (
            <p className="mb-3 text-sm text-muted-foreground">Requires administrator role to edit.</p>
          ) : null}
          <div className="space-y-3">
            <label className="block text-sm text-foreground">
              Google Business Profile URL
              <input
                type="url"
                placeholder="https://g.page/your-business"
                className={inputCls}
                readOnly={showOnlineReadOnly}
                value={merged.google_business_profile_url ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, google_business_profile_url: e.target.value }))}
              />
            </label>
            <label className="block text-sm text-foreground">
              Yelp
              <input
                type="url"
                placeholder="https://yelp.com/biz/your-business"
                className={inputCls}
                readOnly={showOnlineReadOnly}
                value={merged.yelp_listing_url ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, yelp_listing_url: e.target.value }))}
              />
            </label>
            <label className="block text-sm text-foreground">
              Tagline
              <input
                className={inputCls}
                readOnly={showOnlineReadOnly}
                placeholder='e.g. “Family-owned senior living in North Florida since 1981.”'
                value={merged.facility_tagline ?? ""}
                onChange={(e) => setDraft((d) => ({ ...d, facility_tagline: e.target.value }))}
              />
              <span className="mt-1 block text-[12px] text-muted-foreground">
                Shown on the family portal home and public marketing surfaces (max 120 characters recommended).
              </span>
            </label>
          </div>
        </RecordDetailSection>
      )}

      {!capabilities?.can_edit && (
        <p className="text-sm text-muted-foreground">You do not have permission to edit communication settings.</p>
      )}

      {capabilities?.can_edit && (
        <button
          type="submit"
          disabled={isSaving || Boolean(hoursError)}
          className="rounded-[8px] bg-primary px-6 py-2 text-sm text-primary-foreground disabled:opacity-50"
        >
          {isSaving ? "Saving…" : "Save changes"}
        </button>
      )}
    </form>
  );
}
