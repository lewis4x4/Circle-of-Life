import { cookies } from "next/headers";

import { RegisterClient } from "@/components/registers/RegisterClient";
import {
  SELECTED_FACILITY_COOKIE,
  parseSelectedFacilityCookieValue,
} from "@/lib/facilities/selected-facility-cookie";
import { fetchRegister } from "@/lib/registers/load-register";
import { REGISTER_DEFAULT_DAYS, type RegisterRow } from "@/lib/registers/register";
import {
  daysAgoEastern,
  easternDateInputValue,
  easternDayEndIso,
  easternDayStartIso,
} from "@/lib/registers/register-display-copy";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * The register lives under residents, beside the roster it is the history of.
 * It is read only by construction: every row comes from resident status
 * history, so the way to change one is to correct the status.
 */
export default async function AdmissionDischargeRegisterPage() {
  const cookieStore = await cookies();
  const facilityId = parseSelectedFacilityCookieValue(cookieStore.get(SELECTED_FACILITY_COOKIE)?.value);
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const profile = user
    ? (
        await supabase
          .from("user_profiles")
          .select("id, organization_id, app_role")
          .eq("id", user.id)
          .maybeSingle()
      ).data
    : null;

  if (!profile || profile.app_role === "family") {
    return (
      <main className="mx-auto w-full max-w-5xl px-4 py-8">
        <h1 className="text-lg font-medium text-foreground">Admission and discharge register</h1>
        <p className="mt-2 max-w-prose text-sm text-muted-foreground">
          The register lists every resident who moved in or out of this building. Ask an
          administrator if you need a copy.
        </p>
      </main>
    );
  }

  const to = easternDateInputValue(new Date());
  const from = daysAgoEastern(REGISTER_DEFAULT_DAYS);

  let rows: RegisterRow[] = [];
  let loadError: string | null = null;
  if (facilityId && profile.organization_id) {
    try {
      rows = await fetchRegister(supabase, {
        organizationId: profile.organization_id,
        facilityId,
        from: easternDayStartIso(from),
        to: easternDayEndIso(to),
        includeHolds: true,
      });
    } catch {
      loadError = "The register could not be loaded.";
    }
  }

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-lg font-medium text-foreground">Admission and discharge register</h1>
        <p className="mt-1 max-w-prose text-sm text-muted-foreground">
          Every admission, discharge and bed hold Haven has recorded for this building. Nothing here
          is typed: correct a resident&rsquo;s status and the register follows.
        </p>
      </div>
      <RegisterClient
        organizationId={profile.organization_id ?? ""}
        facilityId={facilityId}
        initialRows={rows}
        initialFrom={from}
        initialTo={to}
        loadError={loadError}
      />
    </main>
  );
}
