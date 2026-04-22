import { cookies } from "next/headers";

import {
  parseSelectedFacilityCookieValue,
  SELECTED_FACILITY_COOKIE,
} from "@/lib/facilities/selected-facility-cookie";

export async function getServerSelectedFacilityId(): Promise<string | null> {
  const cookieStore = await cookies();
  return parseSelectedFacilityCookieValue(cookieStore.get(SELECTED_FACILITY_COOKIE)?.value);
}
