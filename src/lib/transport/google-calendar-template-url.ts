import { format } from "date-fns";

export type GoogleCalendarTemplateParams = {
  title: string;
  details?: string;
  location?: string;
  start: Date;
  end: Date;
};

function formatGcalDate(d: Date): string {
  return format(d, "yyyyMMdd'T'HHmmss");
}

/** Google Calendar "create event" URL (one-way add from the browser; not OAuth / not live sync). */
export function buildGoogleCalendarTemplateUrl(p: GoogleCalendarTemplateParams): string {
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
