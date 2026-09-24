import { FacilityGate } from "@/components/common/FacilityGate";
import { SurveyPackChooser } from "@/components/registers/SurveyPackChooser";
import { getServerSelectedFacilityId } from "@/lib/facilities/selected-facility-cookie.server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * Choosing what goes in the pack. The pack itself prints at /print/survey-pack,
 * outside the app shell, so nothing on this page ends up on the paper. The
 * print sheet resolves its building from the scope cookie, so this page reads
 * the same cookie and names that building before anything prints (COL-651).
 */
export default async function SurveyPackPage() {
  const facilityId = await getServerSelectedFacilityId();
  const facilityName = facilityId
    ? ((await (await createClient()).from("facilities").select("name").eq("id", facilityId).maybeSingle()).data
        ?.name ?? null)
    : null;

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 px-4 py-8">
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
        <SurveyPackChooser facilityName={facilityName ?? "the selected facility"} />
      </FacilityGate>
    </main>
  );
}
