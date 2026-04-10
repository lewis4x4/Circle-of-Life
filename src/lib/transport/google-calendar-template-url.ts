import { format } from "date-fns";

/** Shared shape for one-way “add to calendar” links (not OAuth / not live sync). */
export type CalendarComposeParams = {
  title: string;
  details?: string;
  location?: string;
  start: Date;
  end: Date;
};

export type GoogleCalendarTemplateParams = CalendarComposeParams;

function formatGcalDate(d: Date): string {
  return format(d, "yyyyMMdd'T'HHmmss");
}

/** Google Calendar "create event" URL (one-way add from the browser; not OAuth / not live sync). */
export function buildGoogleCalendarTemplateUrl(p: CalendarComposeParams): string {
  const dates = `${formatGcalDate(p.start)}/${formatGcalDate(p.end)}`;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: p.title,
    dates,
  });
  if (p.details) params.set("details", p.details);
  if (p.location) params.set("location", p.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/**
 * Outlook on the web — compose event deeplink (one-way add; uses ISO start/end).
 * Targets Microsoft 365 / work flows; personal Outlook.com users may sign in or use Google.
 */
export function buildOutlookCalendarComposeUrl(p: CalendarComposeParams): string {
  const params = new URLSearchParams({
    path: "/calendar/action/compose",
    rru: "addevent",
    subject: p.title,
    startdt: p.start.toISOString(),
    enddt: p.end.toISOString(),
  });
  if (p.details) params.set("body", p.details);
  if (p.location) params.set("location", p.location);
  return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
}
