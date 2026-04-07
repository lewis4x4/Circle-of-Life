import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { serviceRoleUserHasFacilityAccess } from "@/lib/supabase/service-role-facility-access";

const MANAGER_ROLES = new Set(["owner", "org_admin", "facility_admin", "nurse"]);

export type RoundingRequestContext = {
  admin: ReturnType<typeof createServiceRoleClient>;
  userId: string;
  organizationId: string;
  appRole: string | null;
  currentStaffId: string | null;
};

export async function getRoundingRequestContext(): Promise<
  | { ok: true; context: RoundingRequestContext }
  | { ok: false; status: number; error: string }
> {
  const sessionClient = await createClient();
  const {
    data: { user },
    error: sessionErr,
  } = await sessionClient.auth.getUser();

  if (sessionErr || !user) {
    return { ok: false, status: 401, error: "Not authenticated" };
  }

  let admin: ReturnType<typeof createServiceRoleClient>;
  try {
    admin = createServiceRoleClient();
  } catch (error) {
    console.error("[rounding] service role", error);
    return { ok: false, status: 503, error: "Server configuration error" };
  }

  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("organization_id, app_role")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError || !profile?.organization_id) {
    return { ok: false, status: 403, error: "Profile not found" };
  }

  const { data: staffRow } = await admin
    .from("staff")
    .select("id")
    .eq("user_id", user.id)
    .is("deleted_at", null)
    .maybeSingle();

  return {
    ok: true,
    context: {
      admin,
      userId: user.id,
      organizationId: profile.organization_id,
      appRole: profile.app_role ?? null,
      currentStaffId: staffRow?.id ?? null,
    },
  };
}

export function isRoundingManagerRole(appRole: string | null | undefined) {
  return !!appRole && MANAGER_ROLES.has(appRole);
}

export async function assertRoundingFacilityAccess(
  context: RoundingRequestContext,
  facilityId: string,
) {
  return serviceRoleUserHasFacilityAccess(context.admin, {
    userId: context.userId,
    facilityId,
    organizationId: context.organizationId,
    appRole: context.appRole,
  });
}
