import { redirect } from "next/navigation";

import { UUID_STRING_RE } from "@/lib/supabase/env";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * The typed incident draft is retired (spec 07A §1 findings 2 and 6, §6.3).
 * Every old link lands on the three-tap flow; a resident prefill is preserved.
 */
export default async function CaregiverIncidentDraftRedirectPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const resident = first(params.resident) ?? first(params.residentId);
  if (resident && UUID_STRING_RE.test(resident)) {
    redirect(`/caregiver/report?resident=${encodeURIComponent(resident)}`);
  }
  redirect("/caregiver/report");
}
