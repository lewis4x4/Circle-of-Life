import { redirect } from "next/navigation";

import { UUID_STRING_RE } from "@/lib/supabase/env";

/**
 * The print sheet moved out of the app shell to /print/care-plans/[plan]
 * (COL-387). Links and bookmarks to the old address still land on the sheet.
 */
export default async function LegacyCarePlanPrintRedirect({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ plan?: string | string[] }>;
}) {
  const { id: residentId } = await params;
  const { plan } = await searchParams;
  const planId = Array.isArray(plan) ? plan[0] : plan;
  if (planId && UUID_STRING_RE.test(planId)) {
    redirect(`/print/care-plans/${planId}`);
  }
  redirect(`/admin/residents/${residentId}/care-plan`);
}
