import { describe, expect, it } from "vitest";

import {
  RECEIPT_ON_CALL_UNAVAILABLE_LINE,
  acknowledgedLine,
  channelWord,
  deliveryLine,
  formatReceiptTime,
  formatResidentShortName,
  incidentLine,
  nextCheckLine,
  onCallLine,
  savedLine,
  targetWord,
} from "./receipt-copy";

const TZ = "America/New_York";
const AT_2206 = "2026-09-16T02:06:00.000Z"; // 10:06 PM Eastern

describe("formatting", () => {
  it("formats facility-local wall clock", () => {
    expect(formatReceiptTime(AT_2206, TZ)).toBe("10:06 PM");
    expect(formatReceiptTime(null, TZ)).toBeNull();
    expect(formatReceiptTime("not a date", TZ)).toBeNull();
  });

  it("shortens the resident name to first initial and last name", () => {
    expect(formatResidentShortName("Pat", "Brownell")).toBe("P. Brownell");
    expect(formatResidentShortName(null, "Brownell")).toBe("Brownell");
    expect(formatResidentShortName("Pat", null)).toBe("Pat");
    expect(formatResidentShortName(null, null)).toBe("the resident");
  });
});

describe("savedLine", () => {
  it("names the resident log", () => {
    expect(savedLine({ residentFirstName: "Pat", residentLastName: "Brownell", hasResident: true, savedAtIso: AT_2206, timeZone: TZ })).toBe(
      "Saved to P. Brownell's log at 10:06 PM.",
    );
  });

  it("names the building log without a resident", () => {
    expect(savedLine({ residentFirstName: null, residentLastName: null, hasResident: false, savedAtIso: AT_2206, timeZone: TZ })).toBe(
      "Saved to the building log at 10:06 PM.",
    );
  });
});

describe("delivery lines", () => {
  it("uses the channel words", () => {
    expect(channelWord("push")).toBe("push");
    expect(channelWord("in_app")).toBe("the Today board");
    expect(channelWord("sms")).toBe("text");
    expect(channelWord("voice")).toBe("voice call");
  });

  it("describes a sent push with the wait for acknowledgment", () => {
    expect(
      deliveryLine({ target_name: "Kaye Sorensen", target_role: "Administrator or Assistant", channel: "push", status: "sent", sent_at: AT_2206 }, TZ),
    ).toBe("Kaye Sorensen alerted by push at 10:06 PM. Waiting for acknowledgment.");
  });

  it("falls back to the role word when no person was resolved", () => {
    expect(deliveryLine({ target_name: "Administrator or Assistant", target_role: "Administrator or Assistant", channel: "in_app", status: "sent" }, TZ)).toBe(
      "Administrator or Assistant alerted by the Today board. Waiting for acknowledgment.",
    );
    expect(deliveryLine({ target_name: null, target_role: "on_call_primary", channel: "sms", status: "queued" }, TZ)).toBe(
      "Alerting On-call phone by text.",
    );
  });

  it("says text is not enabled yet for a skipped channel", () => {
    expect(deliveryLine({ target_name: null, target_role: "route", channel: "sms", status: "skipped", skip_reason: "channel_not_enabled" }, TZ)).toBe(
      "Text message not enabled yet.",
    );
    expect(deliveryLine({ target_name: null, target_role: "route", channel: "voice", status: "skipped", skip_reason: "channel_not_enabled" }, TZ)).toBe(
      "Voice call not enabled yet.",
    );
  });

  it("never says nurse", () => {
    expect(targetWord({ target_name: "nurse", target_role: "nurse" })).not.toMatch(/nurse/i);
    expect(targetWord({ target_name: null, target_role: "facility_admin" })).toBe("Administrator");
    expect(targetWord({ target_name: null, target_role: "admin_assistant" })).toBe("Assistant");
  });
});

describe("acknowledged, next check, incident, on-call", () => {
  it("formats the acknowledgment line", () => {
    expect(acknowledgedLine("Kaye Sorensen", "2026-09-16T02:07:00.000Z", TZ)).toBe("Acknowledged by Kaye Sorensen at 10:07 PM.");
    expect(acknowledgedLine(null, "2026-09-16T02:07:00.000Z", TZ)).toBe("Acknowledged by the Administrator or Assistant at 10:07 PM.");
  });

  it("formats the next check line", () => {
    expect(nextCheckLine("2026-09-16T02:20:00.000Z", TZ)).toBe("Next for you: check on them again at 10:20 PM.");
    expect(nextCheckLine(null, TZ)).toBeNull();
  });

  it("formats the incident and on-call lines", () => {
    expect(incidentLine("HOM-2026-0007")).toBe("Incident HOM-2026-0007");
    expect(incidentLine(null)).toBeNull();
    expect(onCallLine("(386) 555-0100")).toBe("Call the on-call phone now: (386) 555-0100");
    expect(onCallLine(null)).toBe(RECEIPT_ON_CALL_UNAVAILABLE_LINE);
  });
});
