import { redirect } from "next/navigation";

import { AdminEmptyState } from "@/components/common/admin-list-patterns";
import { BackLink } from "@/design-system/components/BackLink";
import {
  CARE_PLAN_PRINT_NO_PLAN_DESCRIPTION,
  CARE_PLAN_PRINT_NO_PLAN_TITLE,
} from "@/lib/care-plans/care-plan-print-copy";
import { UUID_STRING_RE } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/server";

/**
 * The print sheet moved out of the app shell to /print/care-plans/[plan]
 * (COL-387). Links and bookmarks to the old address still land on the sheet.
 * Without a plan in the address it prints the resident's plan in effect (or
 * under review); with none, it says so instead of bouncing silently (COL-662).
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
  if (!UUID_STRING_RE.test(residentId)) {
    redirect("/admin/residents");
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("care_plans")
    .select("id")
    .eq("resident_id", residentId)
    .is("deleted_at", null)
    .in("status", ["active", "under_review"])
    .order("effective_date", { ascending: false })
    .limit(1);
  const currentPlanId = data?.[0]?.id;
  if (currentPlanId) {
    redirect(`/print/care-plans/${currentPlanId}`);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 py-8">
      <AdminEmptyState title={CARE_PLAN_PRINT_NO_PLAN_TITLE} description={CARE_PLAN_PRINT_NO_PLAN_DESCRIPTION} />
      <BackLink label="Care plan" href={`/admin/residents/${residentId}/care-plan`} />
    </div>
  );
}
