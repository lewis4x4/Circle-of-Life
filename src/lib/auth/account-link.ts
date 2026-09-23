import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

/**
 * Who to ask when a login is not linked yet: the working facility's name,
 * administrator and phone as posted on the facility row. Any of them may be blank.
 */
export type AccountLinkContact = {
  facilityName: string | null;
  administratorName: string | null;
  phone: string | null;
};

/**
 * Staff-side link: a floor login is usable once a staff row carries its
 * user_id (the `staff_see_own_record` policy lets anyone read their own row).
 * Returns null when the check itself failed, so callers keep the page rather
 * than claim an account is unlinked on a network error.
 */
export async function hasLinkedStaffRecord(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("staff")
    .select("id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .limit(1);
  if (error) {
    console.error("[account-link] staff link check failed", error);
    return null;
  }
  return (data ?? []).length > 0;
}

/**
 * Family-side link: an active (unrevoked) family_resident_links row. Same
 * null-on-failure contract as hasLinkedStaffRecord.
 */
export async function hasLinkedResident(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<boolean | null> {
  const { data, error } = await supabase
    .from("family_resident_links")
    .select("resident_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .limit(1);
  if (error) {
    console.error("[account-link] family link check failed", error);
    return null;
  }
  return (data ?? []).length > 0;
}

export async function loadAccountLinkContact(
  supabase: SupabaseClient<Database>,
  facilityId: string | null,
): Promise<AccountLinkContact> {
  if (!facilityId) return { facilityName: null, administratorName: null, phone: null };
  const { data } = await supabase
    .from("facilities")
    .select("name, administrator_name, phone")
    .eq("id", facilityId)
    .maybeSingle();
  const row = data as { name: string | null; administrator_name: string | null; phone: string | null } | null;
  return {
    facilityName: row?.name?.trim() || null,
    administratorName: row?.administrator_name?.trim() || null,
    phone: row?.phone?.trim() || null,
  };
}
