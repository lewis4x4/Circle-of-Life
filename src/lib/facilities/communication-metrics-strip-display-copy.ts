/**
 * Quiet Operator copy for the facility detail communication metrics strip.
 * Missing notification, visitor, and settings telemetry name real gaps — never fabricate counts.
 */

export const COMMUNICATION_STRIP_LOADING_LAST_FAMILY_NOTIFICATION_COPY =
  "Loading last family notification…";
export const COMMUNICATION_STRIP_LOADING_OPEN_VISITOR_SESSIONS_COPY =
  "Loading open visitor sessions…";
export const COMMUNICATION_STRIP_LOADING_LISTING_HEALTH_COPY = "Loading profile…";
export const COMMUNICATION_STRIP_LOADING_LAST_CHANGE_COPY = "Loading last change…";

export const COMMUNICATION_STRIP_NO_LAST_FAMILY_NOTIFICATION_COPY =
  "No last family notification sent posted";
export const COMMUNICATION_STRIP_NO_OPEN_VISITOR_SESSIONS_COPY =
  "No open visitor sessions posted";
export const COMMUNICATION_STRIP_NO_LISTING_HEALTH_COPY = "No online listing health posted";
export const COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY = "No last change posted";

export type CommunicationStripListingHealth = {
  value: string;
  sub: string;
  warn?: boolean;
};

/** Last family notification tile — telemetry not wired; loading and gap copy only. */
export function formatCommunicationStripLastFamilyNotification(isLoading: boolean): string {
  if (isLoading) return COMMUNICATION_STRIP_LOADING_LAST_FAMILY_NOTIFICATION_COPY;
  return COMMUNICATION_STRIP_NO_LAST_FAMILY_NOTIFICATION_COPY;
}

/** Open visitor sessions tile — session tracking not wired; loading and gap copy only. */
export function formatCommunicationStripOpenVisitorSessions(isLoading: boolean): string {
  if (isLoading) return COMMUNICATION_STRIP_LOADING_OPEN_VISITOR_SESSIONS_COPY;
  return COMMUNICATION_STRIP_NO_OPEN_VISITOR_SESSIONS_COPY;
}

/** Last settings change tile — formatted NY datetime when posted, named gaps otherwise. */
export function formatCommunicationStripLastChange(
  updatedAt: unknown,
  isLoading: boolean,
): string {
  if (isLoading) return COMMUNICATION_STRIP_LOADING_LAST_CHANGE_COPY;
  if (typeof updatedAt !== "string") return COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY;
  const d = new Date(updatedAt);
  if (Number.isNaN(d.getTime())) return COMMUNICATION_STRIP_NO_LAST_CHANGE_COPY;
  return d.toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Online listing health from communication settings URLs; never returns a silent em dash. */
export function resolveCommunicationStripOnlineListingHealth(
  settings: Record<string, unknown> | null,
  isLoading: boolean,
): CommunicationStripListingHealth {
  if (isLoading) {
    return { value: COMMUNICATION_STRIP_LOADING_LISTING_HEALTH_COPY, sub: "Loading profile" };
  }
  if (!settings) {
    return { value: COMMUNICATION_STRIP_NO_LISTING_HEALTH_COPY, sub: "No communication profile on file" };
  }
  const g = String(settings.google_business_profile_url ?? "").trim();
  const y = String(settings.yelp_listing_url ?? "").trim();
  if (g && y) return { value: "Linked", sub: "Google + Yelp on file" };
  if (g) return { value: "Partial", sub: "Google only — add Yelp" };
  if (y) return { value: "Partial", sub: "Yelp only — add Google" };
  return { value: "Review needed", sub: "No listing URLs on file", warn: true };
}

/** Whether the listing-health tile is showing a resolved status (not loading or a named gap). */
export function communicationStripListingHealthIsResolved(health: CommunicationStripListingHealth): boolean {
  return (
    health.value !== COMMUNICATION_STRIP_LOADING_LISTING_HEALTH_COPY &&
    health.value !== COMMUNICATION_STRIP_NO_LISTING_HEALTH_COPY
  );
}
