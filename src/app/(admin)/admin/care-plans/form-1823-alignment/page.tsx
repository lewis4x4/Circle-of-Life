import { cookies } from "next/headers";

import { Form1823AlignmentPageClient } from "@/components/care-plans/Form1823AlignmentPageClient";
import { fetchForm1823AlignmentRoster, type Form1823AlignmentRoster } from "@/lib/care-plans/form-1823-alignment-roster";
import { SELECTED_FACILITY_COOKIE, parseSelectedFacilityCookieValue } from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/server";

export default async function Form1823AlignmentPage() {
  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(cookieStore.get(SELECTED_FACILITY_COOKIE)?.value);

  const supabase = await createClient();
  let initialRoster: Form1823AlignmentRoster | null = null;
  let initialError: string | null = null;
  try {
    initialRoster = await fetchForm1823AlignmentRoster(initialFacilityId, supabase);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Unable to load Form 1823 alignment.";
  }

  return <Form1823AlignmentPageClient initialRoster={initialRoster} initialError={initialError} initialFacilityId={initialFacilityId} />;
}
