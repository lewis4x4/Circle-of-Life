import { FacilityGate } from "@/components/common/FacilityGate";
import { SurveyPackViewsNav } from "@/components/compliance/SurveyPackViewsNav";
import { SurveyReadinessBinder } from "@/components/compliance/SurveyReadinessBinder";
import { SurveyPackChooser } from "@/components/registers/SurveyPackChooser";
import { RiskSurveyBundleSection } from "@/components/risk/RiskSurveyBundleSection";
import { formatSurveyPackBuildingName } from "@/lib/compliance/survey-pack-display-copy";
import { surveyPackView } from "@/lib/compliance/survey-pack-views";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The one survey page (COL-707, Brian 2026-09-23). Print pack, readiness binder and
 * evidence bundle are its views; /admin/survey-binder and /admin/risk/survey-bundle 308
 * here. The pack itself prints at /print/survey-pack, outside the app shell, so nothing
 * on this page ends up on the paper. The print sheet resolves its building from the
 * scope cookie, so this page reads the same cookie and names that building before
 * anything prints (COL-651).
 */
export default async function SurveyPackPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const view = surveyPackView((await searchParams).tab);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8">
      <SurveyPackViewsNav current={view} />
      {view === "binder" ? (
        <SurveyReadinessBinder />
      ) : view === "evidence" ? (
        <RiskSurveyBundleSection />
      ) : (
        <SurveyPrintPack />
      )}
    </main>
  );
}

async function SurveyPrintPack() {
  const facilityId = await getServerSelectedFacilityId();
  const facilityName = facilityId
    ? ((await (await createClient()).from("facilities").select("name").eq("id", facilityId).maybeSingle()).data
        ?.name ?? null)
    : null;

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6">
      <FacilityGate
        facilityId={facilityId}
        title="Survey print pack"
        reason="The register, census record and visitor log a surveyor is handed belong to one building."
      >
        <div>
          <h1 className="text-lg font-medium text-foreground">Survey print pack</h1>
          <p className="mt-1 max-w-prose text-sm text-muted-foreground">
            Print the admission and discharge register, the census record and the visitor log for a
            range. Every print is recorded, so there is a record of what a surveyor was handed.
          </p>
        </div>
        <SurveyPackChooser facilityName={formatSurveyPackBuildingName(facilityName)} />
      </FacilityGate>
    </div>
  );
}
