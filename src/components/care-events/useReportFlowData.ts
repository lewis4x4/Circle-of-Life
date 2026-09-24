"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { loadCaregiverFacilityContext, type CaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import {
  cacheOnCallPhone,
  fetchEveryone,
  fetchLocationChips,
  fetchMyResidentIds,
  fetchOnCallPhone,
  filterMyResidents,
  readCachedOnCallPhone,
  type LocationChip,
} from "@/lib/care-events/report-data";
import type { ReportResident } from "@/lib/care-events/report-state";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";

export type ReportFlowData =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      ctx: CaregiverFacilityContext;
      userId: string;
      everyone: ReportResident[];
      myResidents: ReportResident[];
      locationChips: LocationChip[];
      onCallPhone: string | null;
    };

const CONFIG_MESSAGE = "Haven is not connected to its database on this device. Tell the Administrator or Assistant in person.";
const LOAD_MESSAGE = "The resident list could not be loaded. Tell the Administrator or Assistant in person.";

/**
 * Facility context, census, today's assignment, location chips, and the
 * cached on-call phone for the "Something happened" flow. Reads only; the
 * flow dispatches the state changes.
 */
export function useReportFlowData() {
  const supabase = useMemo(() => createClient(), []);
  const [data, setData] = useState<ReportFlowData>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setData({ status: "loading" });
      if (!isBrowserSupabaseConfigured()) {
        setData({ status: "error", message: CONFIG_MESSAGE });
        return;
      }
      try {
        const resolved = await loadCaregiverFacilityContext(supabase);
        if (!resolved.ok) {
          if (!cancelled) setData({ status: "error", message: resolved.error });
          return;
        }
        const { ctx } = resolved;
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user) {
          if (!cancelled) setData({ status: "error", message: "You need to sign in." });
          return;
        }
        const everyone = await fetchEveryone(supabase, ctx.facilityId);
        const [assignedIds, locationChips, onCallPhone] = await Promise.all([
          fetchMyResidentIds(supabase, { userId: user.id, facilityId: ctx.facilityId, timeZone: ctx.timeZone, shifts: ctx.shifts }).catch(
            () => [] as string[],
          ),
          fetchLocationChips(supabase, ctx.facilityId).catch(() => [] as LocationChip[]),
          fetchOnCallPhone(supabase, { facilityId: ctx.facilityId, timeZone: ctx.timeZone, shifts: ctx.shifts }).catch(() => undefined),
        ]);
        let phone: string | null;
        if (onCallPhone === undefined) {
          phone = readCachedOnCallPhone(ctx.facilityId);
        } else {
          phone = onCallPhone;
          if (typeof navigator === "undefined" || navigator.onLine) cacheOnCallPhone(ctx.facilityId, onCallPhone);
        }
        if (cancelled) return;
        setData({
          status: "ready",
          ctx,
          userId: user.id,
          everyone,
          myResidents: filterMyResidents(everyone, assignedIds),
          locationChips,
          onCallPhone: phone,
        });
      } catch {
        if (!cancelled) setData({ status: "error", message: LOAD_MESSAGE });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [supabase, attempt]);

  return { supabase, data, retry };
}
