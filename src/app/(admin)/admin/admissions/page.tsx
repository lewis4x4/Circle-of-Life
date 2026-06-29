import { Suspense } from "react";
import { cookies } from "next/headers";

import { AdminAdmissionsPageClient } from "@/components/admissions/AdminAdmissionsPageClient";
import { admissionsHubScopeFromSearchParam } from "@/lib/admin/admissions/hub-scope";
import {
  emptyAdmissionsHubBootstrap,
  loadAdmissionsHubBootstrap,
  type AdmissionsHubBootstrap,
} from "@/lib/admissions/admissions-hub-bootstrap";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { createClient } from "@/lib/supabase/server";

type AdminAdmissionsHubPageProps = {
  searchParams: Promise<{ scope?: string }>;
};

export default async function AdminAdmissionsHubPage({
  searchParams,
}: AdminAdmissionsHubPageProps) {
  const params = await searchParams;
  const initialScope = admissionsHubScopeFromSearchParam(params.scope ?? null);

  const cookieStore = await cookies();
  const initialFacilityId = parseSelectedFacilityCookieValue(
    cookieStore.get(SELECTED_FACILITY_COOKIE)?.value,
  );

  let initialBootstrap: AdmissionsHubBootstrap = emptyAdmissionsHubBootstrap();
  let initialLoadError: string | null = null;

  try {
    const supabase = await createClient();
    initialBootstrap = await loadAdmissionsHubBootstrap(
      initialFacilityId,
      initialScope,
      supabase,
    );
  } catch (error) {
    initialLoadError = error instanceof Error ? error.message : "Could not load data.";
  }

  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-6xl px-1 pb-28 pt-6 text-sm text-muted-foreground">
          Loading admissions overview…
        </div>
      }
    >
      <AdminAdmissionsPageClient
        initialBootstrap={initialBootstrap}
        initialLoadError={initialLoadError}
        initialFacilityId={initialFacilityId}
        initialScope={initialScope}
        serverBootstrapped
      />
    </Suspense>
  );
}
