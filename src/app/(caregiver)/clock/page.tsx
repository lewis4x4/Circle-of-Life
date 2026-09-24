import { CaregiverClockPanel } from "@/components/caregiver/CaregiverClockPanel";
import { FrontDoorClockNotice } from "@/components/caregiver/FrontDoorClockNotice";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/service-role";
import { timeclockFlagForUser, type TimeclockFlag } from "@/lib/timeclock/facility-flag";

/**
 * /caregiver/clock (also /clock). One clock (spec 40 §1): where the user's
 * facility clocks staff in at the front-door kiosk, this page punches nothing
 * and says so. The flag is read on the server for the signed-in user; the
 * punch route refuses independently, so a stale page cannot write either.
 */
export default async function CaregiverClockPage() {
  let flag: TimeclockFlag = "unknown";
  let homeHref = "/caregiver";
  try {
    const supabase = await createClient();
    const { data } = await supabase.auth.getUser();
    if (data.user) {
      homeHref = getDashboardRouteForRole(getAppRoleFromClaims(data.user));
      flag = await timeclockFlagForUser(createServiceRoleClient(), data.user.id);
    }
  } catch {
    // Unknown: the panel renders and the punch route decides (it fails closed).
    flag = "unknown";
  }
  if (flag === "on") return <FrontDoorClockNotice homeHref={homeHref} />;
  return <CaregiverClockPanel />;
}
