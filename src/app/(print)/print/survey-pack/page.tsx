import { cookies } from "next/headers";
import { Suspense } from "react";

import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/server";

import { SurveyPackSheet } from "./SurveyPackSheet";

export const dynamic = "force-dynamic";

/**
 * The survey print pack sheet, served outside the app shell so what is on
 * screen is what comes out of the printer. Who printed it and which building
 * are resolved here; the sheet records the print before it renders anything.
 */
export default async function SurveyPackPrintPage() {
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
          .select("id, organization_id, full_name, app_role")
          .eq("id", user.id)
          .maybeSingle()
      ).data
    : null;

  if (!profile || profile.app_role === "family" || !facilityId || !profile.organization_id) {
    return (
      <div className="p-6">
        <p className="text-sm text-neutral-700">
          Open the survey print pack from a facility you administer.
        </p>
      </div>
    );
  }

  const facility = (
    await supabase.from("facilities").select("id, name").eq("id", facilityId).maybeSingle()
  ).data;

  return (
    <Suspense fallback={null}>
      <SurveyPackSheet
        organizationId={profile.organization_id}
        facilityId={facilityId}
        facilityName={facility?.name ?? "This facility"}
        printedByName={profile.full_name ?? "Haven user"}
      />
    </Suspense>
  );
}
