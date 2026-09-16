/**
 * Data Health — the anomalies still present in one facility's data (COL-361).
 *
 * Read only. Every number is computed live by `facility_data_health`, and every
 * one of them is a count with somewhere to go and look. None of it writes.
 *
 * The roster census and the Stand Up census sit side by side with no colour and
 * no verdict. They measure different moments -- the Stand Up is an operator's
 * report for a week, the roster is right now -- and colouring either one would
 * assert which is wrong when nothing in the data says so.
 */

export type FacilityDataHealth = {
  beds_occupied_with_no_resident: number;
  residents_holding_no_bed: number;
  beds_with_two_residents: number;
  roster_census: number;
  stand_up_census: number | null;
  stand_up_week_start: string | null;
  staff_inactive_can_still_sign_in: number;
  active_profiles_with_no_grant: number;
  duplicate_identity_candidates: number;
  last_board_check_closed_at: string | null;
  last_staff_check_closed_at: string | null;
};

/**
 * Why the panel has no counts. COL-442: `forbidden` is the database refusing a
 * facility the caller holds no grant to, and it is a different sentence from a
 * transient failure -- neither of which may read as "this facility is clean".
 */
export type FacilityDataHealthError = "forbidden" | "unavailable";

/**
 * Which set of people or beds a count is actually measuring (COL-438).
 *
 * Two of the identity counts are computed across every facility in the
 * organization, not just the one whose overview is on screen: an account with
 * no live grant belongs to no facility by construction, and the duplicate rule
 * matches on `organization_id`. Reported under a per-facility heading they read
 * as facts about this building, so a change made only at another facility moved
 * this one's panel. They are grouped and labelled separately instead.
 *
 * Circle of Life calls a single building a Facility -- Homewood Lodge is a
 * Facility -- so the wider set is "All facilities", not "Organization".
 */
export type DataHealthScope = "facility" | "all_facilities";

export const DATA_HEALTH_SCOPE_LABELS: Record<DataHealthScope, string> = {
  facility: "This facility",
  all_facilities: "All facilities",
};

export type DataHealthCount = {
  key: string;
  label: string;
  count: number;
  href: string;
  scope: DataHealthScope;
  /** What a non-zero count means, so the number is not a riddle. */
  meaning: string;
};

/** The counts for one scope, in panel order. */
export function dataHealthCountsByScope(
  health: FacilityDataHealth,
  scope: DataHealthScope,
): DataHealthCount[] {
  return dataHealthCounts(health).filter((entry) => entry.scope === scope);
}

export function dataHealthCounts(health: FacilityDataHealth): DataHealthCount[] {
  return [
    {
      key: "beds_occupied_with_no_resident",
      scope: "facility" as const,
      label: "Beds occupied with nobody in them",
      count: health.beds_occupied_with_no_resident,
      href: "/admin/admissions",
      meaning:
        "A bed reads occupied but no resident holds it. This should be zero; migration 388 keeps the two in step.",
    },
    {
      key: "residents_holding_no_bed",
      scope: "facility" as const,
      label: "Residents on census with no bed",
      count: health.residents_holding_no_bed,
      href: "/admin/residents",
      meaning: "Someone is active, on hospital hold or on leave, but Haven does not know which bed is theirs.",
    },
    {
      key: "beds_with_two_residents",
      scope: "facility" as const,
      label: "Beds with two residents",
      count: health.beds_with_two_residents,
      href: "/admin/residents",
      meaning: "Two people hold the same bed. One of them has not been moved or discharged.",
    },
    {
      key: "staff_inactive_can_still_sign_in",
      scope: "facility" as const,
      label: "Offboarded staff who can still sign in",
      count: health.staff_inactive_can_still_sign_in,
      href: "/admin/staff/staff-check",
      meaning: "Employment ended but the Haven login was never revoked. The offboard did not finish.",
    },
    {
      key: "active_profiles_with_no_grant",
      scope: "all_facilities" as const,
      label: "Active accounts with no facility",
      count: health.active_profiles_with_no_grant,
      href: "/admin/settings/users",
      meaning:
        "An account that can sign in but is granted no facility at all. Counted across every facility, because an account with no grant belongs to none of them.",
    },
    {
      key: "duplicate_identity_candidates",
      scope: "all_facilities" as const,
      label: "Possible duplicate identities",
      count: health.duplicate_identity_candidates,
      href: "/admin/staff/staff-check",
      meaning:
        "Same email, same login on two staff records, or the same name twice. Matched across every facility, so a duplicate at another building is counted here too. Suggestions, not findings.",
    },
  ];
}

/**
 * Two numbers and a week. Deliberately a plain sentence rather than a metric
 * card: a card would have to choose which number is the target.
 */
export function censusComparisonLine(
  health: Pick<FacilityDataHealth, "roster_census" | "stand_up_census" | "stand_up_week_start">,
  formatWeek: (iso: string) => string,
): string {
  const roster = `Roster ${health.roster_census}`;
  if (health.stand_up_census == null || health.stand_up_week_start == null) {
    return `${roster} · Stand Up: none filed`;
  }
  return `${roster} · Stand Up ${formatWeek(health.stand_up_week_start)}: ${health.stand_up_census}`;
}

export function lastCheckLine(closedAt: string | null, formatDateTime: (iso: string) => string): string {
  return closedAt ? formatDateTime(closedAt) : "Never";
}

/** Short month and day, for the Stand Up week the census came from. */
export function formatStandUpWeek(iso: string): string {
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
  }).format(parsed);
}
