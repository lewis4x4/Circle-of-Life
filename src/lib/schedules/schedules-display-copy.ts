/**
 * Quiet Operator copy for admin schedule surfaces.
 * Missing publish times name real gaps — never fabricate schedule facts.
 */

export const SCHEDULES_NO_PUBLISH_TIME_COPY = "No publish time posted";

function formatScheduleDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/** Published-at column or subtitle value — posted ISO datetime or explicit missing copy. */
export function formatSchedulePublishedAt(publishedAt: string | null | undefined): string {
  if (!publishedAt || !publishedAt.trim()) return SCHEDULES_NO_PUBLISH_TIME_COPY;
  return formatScheduleDateTime(publishedAt);
}

/** Detail header subtitle: published line with optional notes suffix. */
export function formatSchedulePublishedSubtitle(
  publishedAt: string | null | undefined,
  notes: string | null | undefined,
): string {
  const published = formatSchedulePublishedAt(publishedAt);
  const notesTrimmed = notes?.trim();
  return notesTrimmed ? `Published: ${published} · ${notesTrimmed}` : `Published: ${published}`;
}
