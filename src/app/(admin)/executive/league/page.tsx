import Link from "next/link";
import ExecutiveLeaguePageClient from "@/components/executive/ExecutiveLeaguePageClient";
import { loadExecutiveLeagueData } from "@/lib/executive/load-league-data";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { createClient } from "@/lib/supabase/server";

export default async function ExecutiveLeaguePage() {
  const roleContext = await loadFinanceRoleContextServer();
  if (!roleContext.ok) {
    return <ExecutiveLeaguePageClient initialData={null} initialError={roleContext.error} />;
  }

  if (!["owner", "org_admin"].includes(roleContext.ctx.appRole)) {
    return (
      <section className="space-y-3 p-6" aria-labelledby="league-access-heading">
        <h1 id="league-access-heading" className="text-2xl font-semibold">Portfolio report restricted</h1>
        <p className="text-sm text-muted-foreground">
          The Executive League includes portfolio-wide financial and insurance information.
          Only organization owners and administrators can open this report or export its PDF.
        </p>
        <Link href="/admin/insurance/policies" className="text-sm font-medium underline">
          View approved insurance summaries
        </Link>
      </section>
    );
  }

  const supabase = await createClient();
  let initialData = null;
  let initialError: string | null = null;

  try {
    initialData = await loadExecutiveLeagueData(supabase, roleContext.ctx.organizationId);
  } catch (error) {
    initialError = formatLiveDataLoadError(error, "Could not load executive league.");
  }

  return <ExecutiveLeaguePageClient initialData={initialData} initialError={initialError} />;
}
