import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { StaffCheckClient } from "@/components/facility-checks/StaffCheckClient";
import { fetchActorNames } from "@/lib/facility-checks/load-board-check";
import {
  fetchStaffCheckHistory,
  fetchStaffCheckRows,
  fetchStaffCheckSession,
  type StaffCheckBootstrap,
} from "@/lib/facility-checks/load-staff-check";
import { canRunStaffCheck } from "@/lib/facility-checks/staff-check";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/** Staff Check sits under staff administration, beside the offboard flow it ends in. */
export default async function StaffCheckPage() {
  const cookieStore = await cookies();
  const facilityId = parseSelectedFacilityCookieValue(cookieStore.get(SELECTED_FACILITY_COOKIE)?.value);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase
          .from("user_profiles")
          .select("id, organization_id, app_role")
          .eq("id", user.id)
          .maybeSingle()
      ).data
    : null;

  if (!profile || !canRunStaffCheck(profile.app_role)) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="text-lg font-medium text-foreground">Staff check</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          A staff check ends in deactivating people, so it is run by someone who can offboard staff.
        </p>
      </main>
    );
  }

  const bootstrap = await loadStaffCheck(supabase, facilityId);

  async function refresh() {
    "use server";
    revalidatePath("/admin/staff/staff-check");
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <h1 className="text-lg font-medium text-foreground">Staff check</h1>
      <StaffCheckClient
        session={bootstrap.session}
        initialRows={bootstrap.rows}
        initialHistory={bootstrap.history}
        closedByName={bootstrap.closedByName}
        loadError={bootstrap.error}
        facilityId={facilityId}
        organizationId={profile.organization_id}
        actorId={profile.id}
        staffHref="/staff"
        grantsHref="/admin/settings/users"
        onRefresh={refresh}
      />
    </main>
  );
}

async function loadStaffCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  facilityId: string | null,
): Promise<StaffCheckBootstrap> {
  const empty: StaffCheckBootstrap = {
    session: null,
    rows: [],
    history: [],
    closedByName: null,
    error: null,
  };
  if (!facilityId) return empty;

  try {
    const session = await fetchStaffCheckSession(supabase, facilityId);
    if (!session) return empty;
    const rows = await fetchStaffCheckRows(supabase, session.id);
    const history = await fetchStaffCheckHistory(supabase, session.id, rows);
    const closedByName = session.closedBy
      ? ((await fetchActorNames(supabase, [session.closedBy])).get(session.closedBy) ?? null)
      : null;
    return { session, rows, history, closedByName, error: null };
  } catch {
    return { ...empty, error: "The identity list could not be loaded." };
  }
}
