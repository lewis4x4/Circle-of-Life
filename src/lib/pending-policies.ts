import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

export type PendingPolicySummary = {
  id: string;
  title: string;
  category: string;
  facility_id: string;
  published_at: string | null;
  acknowledgment_due_days: number;
};

const STAFF_ROLES = new Set([
  "owner",
  "org_admin",
  "facility_admin",
  "nurse",
  "caregiver",
  "dietary",
  "maintenance_role",
]);

/**
 * Resolves facility id for floor staff (staff row), first UFA row, or (owner/org_admin) first org facility.
 */
export async function resolveAckFacilityId(
  supabase: SupabaseClient<Database>,
  userId: string,
): Promise<string | null> {
  const profile = await supabase
    .from("user_profiles")
    .select("app_role, organization_id")
    .eq("id", userId)
    .maybeSingle();
  const role = profile.data?.app_role;
  const orgId = profile.data?.organization_id;

  if ((role === "owner" || role === "org_admin") && orgId) {
    const fac = await supabase
      .from("facilities")
      .select("id")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .order("name")
      .limit(1)
      .maybeSingle();
    if (fac.data?.id) return fac.data.id;
  }

  const staff = await supabase
    .from("staff")
    .select("facility_id")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .maybeSingle();
  if (staff.data?.facility_id) return staff.data.facility_id;

  const ufa = await supabase
    .from("user_facility_access")
    .select("facility_id")
    .eq("user_id", userId)
    .is("revoked_at", null)
    .limit(1)
    .maybeSingle();
  return ufa.data?.facility_id ?? null;
}

/**
 * Pending published policies requiring acknowledgment for the current user at a facility.
 * Denominator for admin dashboards uses eligible staff count; this only lists the viewer's pending items.
 */
export async function fetchPendingPoliciesForUser(
  supabase: SupabaseClient<Database>,
  userId: string,
  facilityId: string,
): Promise<PendingPolicySummary[]> {
  const profile = await supabase.from("user_profiles").select("app_role").eq("id", userId).maybeSingle();
  const role = profile.data?.app_role as string | undefined;
  if (!role || !STAFF_ROLES.has(role) || role === "family" || role === "broker") {
    return [];
  }

  const { data: policies, error: polErr } = await supabase
    .from("policy_documents")
    .select("id, title, category, facility_id, published_at, acknowledgment_due_days, requires_acknowledgment, status")
    .eq("facility_id", facilityId)
    .eq("status", "published")
    .eq("requires_acknowledgment", true)
    .is("deleted_at", null);

  if (polErr || !policies?.length) return [];

  const { data: acks } = await supabase
    .from("policy_acknowledgments")
    .select("policy_document_id")
    .eq("user_id", userId);

  const acked = new Set((acks ?? []).map((a) => a.policy_document_id));

  return policies
    .filter((p) => !acked.has(p.id))
    .map((p) => ({
      id: p.id,
      title: p.title,
      category: p.category,
      facility_id: p.facility_id,
      published_at: p.published_at,
      acknowledgment_due_days: p.acknowledgment_due_days,
    }));
}
