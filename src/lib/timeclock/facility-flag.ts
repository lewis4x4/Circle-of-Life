/**
 * One clock (COL-677 spec 40 §1): where a facility's `timeclock_enabled` is on,
 * staff clock in and out at the front-door kiosk only and `/caregiver/clock`
 * writes nothing to `time_records`.
 *
 * Staff cannot read `timeclock_facility_settings` under RLS (managers only), so
 * this reads it with the service-role client. NOTE: migration 408 grants that
 * table to `authenticated` only, so today the service-role read is refused
 * (42501) and answers `unknown` until the service role is granted SELECT. The
 * database enforces the rule regardless (migration 483's restrictive
 * time_records policies), and /api/caregiver/clock maps that refusal to the
 * front-door answer. Server only: never import from a
 * client component. Callers pass a user id or facility id they resolved from the
 * session themselves, never one taken from request input.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export { FRONT_DOOR_CLOCK_COPY } from "@/lib/timeclock/front-door-copy";

type Admin = SupabaseClient<Database>;

/** `unknown` when the settings could not be read; callers decide how to degrade. */
export type TimeclockFlag = "on" | "off" | "unknown";

/** The flag for one facility inside one organization. No settings row means off. */
export async function timeclockFlagForFacility(admin: Admin, organizationId: string, facilityId: string): Promise<TimeclockFlag> {
  const { data, error } = await admin
    .from("timeclock_facility_settings")
    .select("timeclock_enabled")
    .eq("organization_id", organizationId)
    .eq("facility_id", facilityId)
    .maybeSingle();
  if (error) return "unknown";
  return data?.timeclock_enabled === true ? "on" : "off";
}

/**
 * The flag for a signed-in user: on when any facility they work at (current
 * facility grants plus their staff record's facility) has the kiosk turned on.
 */
export async function timeclockFlagForUser(admin: Admin, userId: string): Promise<TimeclockFlag> {
  const [profile, access, staff] = await Promise.all([
    admin.from("user_profiles").select("organization_id").eq("id", userId).maybeSingle(),
    admin.from("user_facility_access").select("facility_id").eq("user_id", userId).is("revoked_at", null),
    admin.from("staff").select("facility_id").eq("user_id", userId).is("deleted_at", null),
  ]);
  if (profile.error || access.error || staff.error) return "unknown";
  const organizationId = profile.data?.organization_id;
  if (!organizationId) return "off";
  const facilityIds = [
    ...new Set([...(access.data ?? []).map((row) => row.facility_id), ...(staff.data ?? []).map((row) => row.facility_id)].filter(Boolean)),
  ];
  if (facilityIds.length === 0) return "off";
  const { data, error } = await admin
    .from("timeclock_facility_settings")
    .select("facility_id")
    .eq("organization_id", organizationId)
    .in("facility_id", facilityIds)
    .eq("timeclock_enabled", true)
    .limit(1);
  if (error) return "unknown";
  return (data ?? []).length > 0 ? "on" : "off";
}
