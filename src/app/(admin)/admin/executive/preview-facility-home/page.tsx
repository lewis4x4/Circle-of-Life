import { redirect } from "next/navigation";

import { FacilityGate } from "@/components/common/FacilityGate";
import { FacilityOperatorHomePageClient } from "@/components/home/FacilityOperatorHomePageClient";
import { canOpenExecutiveOverview } from "@/lib/auth/executive-nav-access";
import { getServerAuthContext } from "@/lib/auth/server-context";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { loadHome } from "@/lib/home/load-home";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * "Preview as facility admin" (COL-707, Brian 2026-09-23). Owners and org admins land
 * on the executive summary and never saw the Facility Operator Home their
 * administrators work from. This renders that Home for the selected building in
 * read-only mode: the component mounts no claim, clear, payment, note or call-out
 * control, and its write handlers refuse to run.
 */
export default async function PreviewFacilityHomePage() {
  const auth = await getServerAuthContext();
  if (!auth.ok) redirect("/login");
  if (!canOpenExecutiveOverview(auth.ctx.appRole)) redirect("/admin");

  const facilityId = await getServerSelectedFacilityId();
  if (!facilityId) {
    return (
      <main className="mx-auto w-full max-w-3xl px-4 py-8">
        <FacilityGate
          facilityId={null}
          title="Preview as facility admin"
          reason="The facility admin's Home is one building's day. Choose the building to preview."
        >
          {null}
        </FacilityGate>
      </main>
    );
  }

  const supabase = await createClient();
  const initial = await loadHome(supabase, { facilityId, organizationId: auth.ctx.organizationId });
  return (
    <FacilityOperatorHomePageClient
      key={facilityId}
      initial={initial}
      initialFacilityId={facilityId}
      currentUserId={auth.ctx.userId}
      fullName={null}
      readOnly
    />
  );
}
