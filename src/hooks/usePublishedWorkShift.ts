"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { currentAssignmentInterval, fetchUserAssignmentIntervals, nextAssignmentInterval, type ScheduleAssignmentInterval } from "@/lib/schedules/assignment-context";

/** Personal planned context only. Clinical permission and actual attendance remain independent. */
export function usePublishedWorkShift(facilityId: string | null | undefined, userId: string | null | undefined) {
  const [result, setResult] = useState<{ scope: string; current: ScheduleAssignmentInterval | null; status: "ready" | "unavailable" }>({ scope: "", current: null, status: "ready" });
  const scope = `${facilityId ?? ""}:${userId ?? ""}`;
  useEffect(() => {
    if (!facilityId || !userId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request = 0;
    const client = createClient();
    const load = async () => {
      const attempt = ++request;
      if (timer) clearTimeout(timer);
      try {
        const now = new Date();
        const rows = await fetchUserAssignmentIntervals(client, { facilityId, userId, from: now, to: new Date(now.getTime() + 86400000) });
        if (stopped || attempt !== request) return;
        const current = currentAssignmentInterval(rows, now);
        const next = nextAssignmentInterval(rows, now);
        setResult({ scope, current, status: "ready" });
        const boundary = current?.ends_at || next?.starts_at;
        timer = setTimeout(() => void load(), boundary ? Math.max(1000, Math.min(900000, new Date(boundary).getTime() - now.getTime() + 1)) : 900000);
      } catch {
        if (!stopped && attempt === request) setResult({ scope, current: null, status: "unavailable" });
      }
    };
    const visible = () => { if (document.visibilityState === "visible") void load(); };
    void load();
    document.addEventListener("visibilitychange", visible);
    return () => { stopped = true; if (timer) clearTimeout(timer); document.removeEventListener("visibilitychange", visible); };
  }, [facilityId, userId, scope]);
  return result.scope === scope ? result : { current: null, status: "loading" as const };
}
