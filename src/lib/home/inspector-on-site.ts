import type { SupabaseClient } from "@supabase/supabase-js";

import { visitorLeftOpenThresholdIso } from "@/lib/registers/register-display-copy";
import type { Database } from "@/types/database";

/** An inspector or official who signed in (kiosk or desk) and has not signed out (COL-692, spec 40 §7). */
export type HomeOpenInspection = { id: string; checkedInAt: string; agency: string | null };

type OpenInspectionRow = { id: string; checked_in_at: string; visitor_company: string | null };

/**
 * Open `surveyor_regulator` visits at this facility: not signed out, not
 * voided, and signed in since the desk log's left-open cutoff (the most
 * recent 04:00 Eastern). An inspector who never tapped Leaving stops raising
 * the banner at that cutoff; the desk log keeps showing them as left open.
 * Read under the staff SELECT policy on visitor_log_entries, which the
 * generated types do not list yet (hence `as never`).
 */
export async function fetchOpenInspections(
  supabase: SupabaseClient<Database>,
  facilityId: string,
  now: Date = new Date(),
): Promise<HomeOpenInspection[]> {
  const { data, error } = await supabase
    .from("visitor_log_entries" as never)
    .select("id, checked_in_at, visitor_company")
    .eq("facility_id", facilityId)
    .eq("visitor_type", "surveyor_regulator")
    .is("checked_out_at", null)
    .is("voided_at", null)
    .is("deleted_at", null)
    .gte("checked_in_at", visitorLeftOpenThresholdIso(now))
    .order("checked_in_at", { ascending: true })
    .limit(10);
  if (error) throw new Error(error.message);
  return ((data ?? []) as unknown as OpenInspectionRow[]).map((row) => ({ id: row.id, checkedInAt: row.checked_in_at, agency: row.visitor_company }));
}

function clock(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone }).formatToParts(new Date(iso));
  const pick = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${pick("hour")}:${pick("minute")} ${pick("dayPeriod").toUpperCase()}`;
}

/** "An inspector from AHCA signed in at the front door at 10:12 AM." */
export function openInspectionLine(inspections: HomeOpenInspection[], timeZone: string): string | null {
  const first = inspections[0];
  if (!first) return null;
  const at = clock(first.checkedInAt, timeZone);
  if (inspections.length > 1) return `${inspections.length} inspectors or officials are in the building. The first signed in at ${at}.`;
  const who = first.agency ? `An inspector from ${first.agency}` : "An inspector";
  return `${who} signed in at the front door at ${at}.`;
}
