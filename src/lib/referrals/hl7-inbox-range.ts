import { startOfDay, subDays } from "date-fns";
import { fromZonedTime, toZonedTime } from "date-fns-tz";

/** COL facilities anchor to America/New_York (foundation spec). */
export const HL7_INBOX_TZ = "America/New_York";

export type Hl7InboxRangeKey = "today" | "7d" | "30d" | "all";

/** UTC ISO boundary for inbound list / export queries; `null` means no lower bound. */
export function hl7InboxRangeStartUtc(range: Hl7InboxRangeKey): string | null {
  if (range === "all") return null;
  const now = new Date();
  const zNow = toZonedTime(now, HL7_INBOX_TZ);
  const zStart =
    range === "today"
      ? startOfDay(zNow)
      : range === "7d"
        ? startOfDay(subDays(zNow, 6))
        : startOfDay(subDays(zNow, 29));
  return fromZonedTime(zStart, HL7_INBOX_TZ).toISOString();
}
