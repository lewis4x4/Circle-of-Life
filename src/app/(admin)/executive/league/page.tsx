import ExecutiveLeaguePageClient from "@/components/executive/ExecutiveLeaguePageClient";
import { loadExecutiveLeagueData } from "@/lib/executive/load-league-data";
import { loadFinanceRoleContextServer } from "@/lib/finance/load-finance-context.server";
import { createClient } from "@/lib/supabase/server";

export default async function ExecutiveLeaguePage() {
  const roleContext = await loadFinanceRoleContextServer();
  if (!roleContext.ok) {
    return <ExecutiveLeaguePageClient initialData={null} initialError={roleContext.error} />;
  }

  const supabase = await createClient();
  let initialData = null;
  let initialError: string | null = null;

  try {
    initialData = await loadExecutiveLeagueData(supabase, roleContext.ctx.organizationId);
  } catch (error) {
    initialError = error instanceof Error ? error.message : "Could not load executive league.";
  }

  return <ExecutiveLeaguePageClient initialData={initialData} initialError={initialError} />;
}
