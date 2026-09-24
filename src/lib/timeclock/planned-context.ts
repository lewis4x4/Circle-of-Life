import { formatInTimeZone } from "date-fns-tz";
import { fetchScheduleAssignmentIntervals } from "@/lib/schedules/assignment-context";
import type { createServiceRoleClient } from "@/lib/supabase/service-role";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import type { KioskPlannedContext } from "./kiosk-contract";

/** Credential resolution supplies these IDs; request-body IDs never scope kiosk schedule access. */
export async function loadKioskPlannedContext(client: ReturnType<typeof createServiceRoleClient>, verified: Record<string, unknown>, now = new Date()): Promise<KioskPlannedContext> {
  if (typeof verified.staff_id !== "string" || !UUID_STRING_RE.test(verified.staff_id) || typeof verified.facility_id !== "string" || !UUID_STRING_RE.test(verified.facility_id)) return { status: "unavailable" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const rows = await Promise.race([
      fetchScheduleAssignmentIntervals(client, { staffId: verified.staff_id, facilityId: verified.facility_id, from: new Date(+now - 86400_000), to: new Date(+now + 86400_000) }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Planned schedule lookup timed out")), 1500); }),
    ]);
    const blocks = rows.filter((row) => row.staff_id === verified.staff_id && row.facility_id === verified.facility_id && (row.service_date === formatInTimeZone(now, row.time_zone, "yyyy-MM-dd") || (new Date(row.starts_at) <= now && now < new Date(row.ends_at)))).map((row) => ({
      label: row.label, color: row.color, starts_at: row.starts_at, ends_at: row.ends_at, time_zone: row.time_zone,
      block_index: row.block_index, block_count: row.block_count,
    }));
    return { status: "ready", blocks };
  } catch { return { status: "unavailable" }; }
  finally { if (timer) clearTimeout(timer); }
}
