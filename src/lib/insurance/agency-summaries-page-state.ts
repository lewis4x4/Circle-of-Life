/**
 * Quiet Operator copy for the agency summaries surface.
 *
 * This page shows insurance facts Haven did not author — they come from the
 * agency's own system through the InsureFlow feed. That makes two things
 * mandatory rather than nice: say how old the information is, and say what is
 * missing. A summary page that silently omits withheld records is worse than no
 * page, because it looks complete.
 */

export type AgencySummaryConnection = {
  id: string;
  name: string;
  mode: "synthetic" | "live";
  enabled: boolean;
  state: string | null;
  last_authorization_check_at: string | null;
  authorization_valid_until: string | null;
  incomplete_summary_count: number;
  summaries: AgencySummary[];
};

export type AgencySummary = {
  source_policy_id: string;
  release_id: string;
  source_released_at: string | null;
  received_at: string | null;
  mapped_entity_id: string;
  mapped_entity_name: string;
  summary: {
    policy_number?: string | null;
    carrier?: string | null;
    line_of_business?: string | null;
    named_insured?: string | null;
    effective_date?: string | null;
    expiration_date?: string | null;
    premium?: number | null;
    status?: string | null;
  };
};

export type AgencySummaryView = {
  live_connection_enabled: boolean;
  connections: AgencySummaryConnection[];
};

export const AGENCY_SUMMARIES_LOADING_COPY = "Loading agency summaries…";

export const AGENCY_SUMMARIES_NO_CONNECTION_COPY =
  "No agency feed is configured. Nothing on this page is missing — there is nothing connected to show.";

/** A connection is only trustworthy while its authorization is inside its window. */
export function isAuthorizationFresh(
  connection: Pick<AgencySummaryConnection, "authorization_valid_until">,
  now: Date,
): boolean {
  if (!connection.authorization_valid_until) return false;
  const until = Date.parse(connection.authorization_valid_until);
  return Number.isFinite(until) && until > now.getTime();
}

/**
 * One line naming what this connection is not showing. Null only when it is
 * genuinely showing everything it has.
 */
export function incompleteSummaryDisclosure(
  connection: Pick<AgencySummaryConnection, "incomplete_summary_count" | "summaries">,
): string | null {
  const withheld = Math.max(0, connection.incomplete_summary_count ?? 0);
  if (withheld === 0) return null;
  const shown = connection.summaries.length;
  const total = shown + withheld;
  if (shown === 0) {
    return (
      `The agency released ${total} ${total === 1 ? "record" : "records"} and none can be shown. ` +
      `They are withheld pending an approved account mapping, not missing from the agency.`
    );
  }
  return (
    `Showing ${shown} of ${total}. ${withheld} ${withheld === 1 ? "record is" : "records are"} withheld ` +
    `pending an approved account mapping — they exist at the agency and are not displayed here.`
  );
}

/** How stale the information is, in the operator's words rather than a timestamp. */
export function freshnessDisclosure(
  connection: Pick<AgencySummaryConnection, "last_authorization_check_at" | "authorization_valid_until" | "state">,
  now: Date,
): string {
  if (!connection.last_authorization_check_at) {
    return "Never synchronised. Nothing here has been confirmed with the agency.";
  }
  const checked = Date.parse(connection.last_authorization_check_at);
  if (!Number.isFinite(checked)) {
    return "Last synchronisation time is not recorded.";
  }
  const stale = !isAuthorizationFresh(connection, now);
  const minutes = Math.max(0, Math.round((now.getTime() - checked) / 60000));
  const age =
    minutes < 60
      ? `${minutes} minute${minutes === 1 ? "" : "s"} ago`
      : minutes < 60 * 48
        ? `${Math.round(minutes / 60)} hour${Math.round(minutes / 60) === 1 ? "" : "s"} ago`
        : `${Math.round(minutes / 1440)} days ago`;

  if (stale) {
    return `Last confirmed with the agency ${age}, which is outside the agreed freshness window. Treat as unconfirmed.`;
  }
  return `Last confirmed with the agency ${age}.`;
}

/**
 * `degraded` is not an error. The receiver reports it when the membership is
 * valid but some bodies are unresolved, which is exactly the state a partial
 * account mapping produces — so it must read as an explanation, not an alarm.
 */
export function connectionStateCopy(state: string | null, enabled = true): string {
  // A disabled connection is not a broken one, and saying "never synchronised"
  // without saying "disabled" makes an intentional state look like a fault.
  if (!enabled) return "Disabled — not synchronising";
  switch (state) {
    case "healthy":
      return "Synchronised";
    case "degraded":
      return "Synchronised, some records withheld";
    case "credential_rejected":
      return "The agency rejected Haven's credential. Nothing here is updating.";
    case "never_synced":
      return "Not yet synchronised";
    default:
      return "State not reported";
  }
}
