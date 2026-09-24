"use client";

import { useEffect, useState } from "react";

import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { loadMovementBackdateWindowDays } from "@/lib/operating-rules/operating-rules";
import {
  backdateWindowHint,
  isBeyondBackdateWindow,
  type MovementWhenDraft,
} from "@/lib/residents/movement-effective-at";
import { createClient } from "@/lib/supabase/client";

const FIELD =
  "w-full rounded-[8px] border border-input bg-card px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

/**
 * The facility's back-date window (operating rule
 * `resident_movement.backdate_window_days`). undefined while loading, null when
 * it could not be read (the database then treats every back-date as needing an
 * owner or org admin, and so does the form).
 */
export function useMovementBackdateWindow(input: {
  residentId?: string | null;
  facilityId?: string | null;
  enabled?: boolean;
}): number | null | undefined {
  const { residentId, facilityId, enabled = true } = input;
  const [loaded, setLoaded] = useState<{ key: string; days: number | null } | null>(null);
  const key = `${residentId ?? ""}|${facilityId ?? ""}`;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      let days: number | null = null;
      try {
        const supabase = createClient();
        let facility = facilityId ?? null;
        if (!facility && residentId) {
          const res = (await supabase
            .from("residents")
            .select("facility_id")
            .eq("id", residentId)
            .maybeSingle()) as unknown as { data: { facility_id: string | null } | null };
          facility = res.data?.facility_id ?? null;
        }
        days = await loadMovementBackdateWindowDays(supabase as never, { facilityId: facility });
      } catch {
        days = null;
      }
      if (!cancelled) setLoaded({ key, days });
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, facilityId, residentId, key]);

  return loaded && loaded.key === key ? loaded.days : undefined;
}

/**
 * "When did this happen?" for a resident movement (COL-750). Date and time are
 * Eastern and empty until someone types them: both blank means it happened
 * just now, and the save time is recorded. Older than the back-date window
 * asks for the reason it is late.
 */
export function MovementWhenFields({
  value,
  onChange,
  windowDays,
  idPrefix,
  dateLabel = "Date it happened",
  dateRequired = false,
  disabled = false,
}: {
  value: MovementWhenDraft;
  onChange: (next: MovementWhenDraft) => void;
  windowDays: number | null | undefined;
  idPrefix: string;
  dateLabel?: string;
  dateRequired?: boolean;
  disabled?: boolean;
}) {
  const today = todayFacilityDateIso();
  const late =
    windowDays !== undefined && value.date.trim() !== "" && value.time.trim() !== ""
      ? isBeyondBackdateWindow(value.date.trim(), windowDays)
      : false;
  const hint = backdateWindowHint(windowDays);

  return (
    <fieldset className="space-y-3" disabled={disabled}>
      <legend className="text-sm font-medium">When did this happen?</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1.5" htmlFor={`${idPrefix}-date`}>
          <span className="block text-xs font-medium text-muted-foreground">{dateLabel}</span>
          <input
            id={`${idPrefix}-date`}
            type="date"
            max={today}
            value={value.date}
            onChange={(event) => onChange({ ...value, date: event.target.value })}
            className={FIELD}
          />
        </label>
        <label className="block space-y-1.5" htmlFor={`${idPrefix}-time`}>
          <span className="block text-xs font-medium text-muted-foreground">Time (Eastern)</span>
          <input
            id={`${idPrefix}-time`}
            type="time"
            value={value.time}
            onChange={(event) => onChange({ ...value, time: event.target.value })}
            className={FIELD}
          />
        </label>
      </div>
      <p className="text-xs text-muted-foreground">
        {dateRequired
          ? "Leave the time blank only if it happened just now today."
          : "Leave both blank if it happened just now."}
        {hint ? ` ${hint}` : ""}
      </p>
      {late ? (
        <label className="block space-y-1.5" htmlFor={`${idPrefix}-reason`}>
          <span className="block text-xs font-medium text-muted-foreground">Why is this being entered late?</span>
          <textarea
            id={`${idPrefix}-reason`}
            maxLength={500}
            rows={2}
            value={value.reason}
            onChange={(event) => onChange({ ...value, reason: event.target.value })}
            className={FIELD}
          />
        </label>
      ) : null}
    </fieldset>
  );
}
