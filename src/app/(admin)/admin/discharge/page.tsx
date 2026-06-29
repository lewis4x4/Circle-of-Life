import { cookies } from "next/headers";

import { DischargeMedRecHubClient } from "@/components/admin/discharge/discharge-med-rec-hub-client";
import { dischargeHubScopeFromSearchParam } from "@/lib/admin/discharge/hub-scope";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import {
  loadDischargeHubBootstrap,
  type DischargeMedRecHubRow,
} from "@/lib/discharge/load-discharge-hub-bootstrap";
import { createClient } from "@/lib/supabase/server";

type AdminDischargeHubPageProps = {
  searchParams: Promise<{ scope?: string; phase?: string }>;
};

export default async function AdminDischargeHubPage({
  searchParams,
}: AdminDischargeHubPageProps) {
  const params = await searchParams;
  const initialScope = dischargeHubScopeFromSearchParam(params.scope ?? null);

  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  let initialRows: DischargeMedRecHubRow[] = [];
  let initialLoadFailed = false;
  let initialIsRowsCapped = false;

  try {
    const supabase = await createClient();
    const bootstrap = await loadDischargeHubBootstrap(
      initialFacilityId,
      initialScope,
      supabase,
    );
    initialRows = bootstrap.rows;
    initialIsRowsCapped = bootstrap.isRowsCapped;
  } catch {
    initialLoadFailed = true;
  }

  return (
    <DischargeMedRecHubClient
      hubBasePath="/admin/discharge"
      initialRows={initialRows}
      initialLoadFailed={initialLoadFailed}
      initialIsRowsCapped={initialIsRowsCapped}
      initialFacilityId={initialFacilityId}
      initialScope={initialScope}
      serverBootstrapped
    />
  );
}
