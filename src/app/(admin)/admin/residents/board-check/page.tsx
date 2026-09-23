import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";

import { BoardCheckClient } from "@/components/facility-checks/BoardCheckClient";
import { canRunBoardCheck } from "@/lib/facility-checks/board-check";
import {
  fetchActorNames,
  fetchBoardCheckHistory,
  fetchBoardCheckRows,
  fetchBoardCheckSession,
  type BoardCheckBootstrap,
} from "@/lib/facility-checks/load-board-check";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Board Check lives under residents, beside the roster it reconciles. The walk
 * is about who is in which bed, and the roster is where that question already
 * gets asked.
 */
export default async function BoardCheckPage() {
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

  if (!profile || !canRunBoardCheck(profile.app_role)) {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="text-lg font-medium text-foreground">Board check</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          A board check is run by someone who can admit and discharge residents. Ask an administrator
          to walk the building with you.
        </p>
      </main>
    );
  }

  const bootstrap = await loadBoardCheck(supabase, facilityId);

  async function refresh() {
    "use server";
    revalidatePath("/admin/residents/board-check");
  }

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      {/* The client renders the page's one h1 (COL-658: this duplicated it). */}
      <BoardCheckClient
        session={bootstrap.session}
        initialRows={bootstrap.rows}
        initialHistory={bootstrap.history}
        closedByName={bootstrap.closedByName}
        loadError={bootstrap.error}
        facilityId={facilityId}
        organizationId={profile.organization_id}
        actorId={profile.id}
        residentsHref="/admin/residents"
        onRefresh={refresh}
      />
    </main>
  );
}

async function loadBoardCheck(
  supabase: Awaited<ReturnType<typeof createClient>>,
  facilityId: string | null,
): Promise<BoardCheckBootstrap> {
  const empty: BoardCheckBootstrap = {
    session: null,
    rows: [],
    history: [],
    closedByName: null,
    error: null,
  };
  if (!facilityId) return empty;

  try {
    const session = await fetchBoardCheckSession(supabase, facilityId);
    if (!session) return empty;
    const rows = await fetchBoardCheckRows(supabase, session.id);
    const history = await fetchBoardCheckHistory(supabase, session.id, rows);
    const closedByName = session.closedBy
      ? ((await fetchActorNames(supabase, [session.closedBy])).get(session.closedBy) ?? null)
      : null;
    return { session, rows, history, closedByName, error: null };
  } catch {
    return { ...empty, error: "The bed list could not be loaded." };
  }
}
