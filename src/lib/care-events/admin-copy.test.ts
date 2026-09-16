import { describe, expect, it } from "vitest";

import {
  acknowledgedByLine,
  ahcaReasonLabel,
  ahcaReasonOptions,
  careEventCloseGateLine,
  channelWord,
  correctiveActionChips,
  deliverySkipReasonLine,
  deliveryStatusWord,
  deliveryTargetWord,
  formatClockTime,
  formatCorrectiveActionNotes,
  formatTimeSince,
  isCloseGateItem,
  loweredLevelLine,
  lowerLevelReasonLabel,
  lowerLevelReasonOptions,
  minutesBetween,
} from "./admin-copy";

const TZ = "America/New_York";
const T0 = Date.parse("2026-09-16T02:00:00.000Z"); // 10:00 PM Eastern

describe("reason chips", () => {
  it("stores AHCA reasons as codes with the s. 429.23 labels", () => {
    expect(ahcaReasonOptions.map((option) => option.code)).toEqual([
      "death",
      "brain_spinal",
      "disfigurement",
      "fracture_dislocation",
      "transfer_acute",
      "law_enforcement",
      "elopement_risk",
    ]);
    expect(ahcaReasonLabel("fracture_dislocation")).toBe("Fracture or dislocation");
    expect(ahcaReasonLabel("nope")).toBeNull();
    expect(ahcaReasonLabel(null)).toBeNull();
  });

  it("names the lower-level reasons and never shows a raw code", () => {
    expect(lowerLevelReasonOptions.map((option) => option.label)).toEqual([
      "Reassessed on scene",
      "Duplicate report",
      "Answered in error",
      "Administrator judgment",
    ]);
    expect(lowerLevelReasonLabel("duplicate_report")).toBe("Duplicate report");
    expect(lowerLevelReasonLabel("free text from sql")).toBe("Reason on file");
    expect(lowerLevelReasonLabel(null)).toBe("No reason posted");
  });

  it("keeps care_plan_review as the code the completion function checks", () => {
    expect(correctiveActionChips[0]).toEqual({ code: "care_plan_review", label: "Care plan review" });
    expect(correctiveActionChips.at(-1)?.code).toBe("other");
  });

  it("translates resolution notes written as codes", () => {
    expect(formatCorrectiveActionNotes("care_plan_review; staff_retrained; Replaced the bed rail")).toBe(
      "Care plan review; Staff retrained; Replaced the bed rail",
    );
    expect(formatCorrectiveActionNotes("  ")).toBeNull();
    expect(formatCorrectiveActionNotes(null)).toBeNull();
  });
});

describe("close gate", () => {
  it("lists the missing items in plain words", () => {
    expect(careEventCloseGateLine(["family_notified", "physician_notified", "ahca_decision"])).toBe(
      "Still needed: family decision, physician decision, AHCA decision",
    );
    expect(careEventCloseGateLine(["acknowledgment", "ems_decision", "video_secured", "dcf_report"])).toBe(
      "Still needed: acknowledgment, EMS decision, video decision, DCF report",
    );
  });

  it("returns null when nothing is missing and tolerates unknown items", () => {
    expect(careEventCloseGateLine([])).toBeNull();
    expect(careEventCloseGateLine(["something_new"])).toBe("Still needed: something new");
    expect(isCloseGateItem("ahca_decision")).toBe(true);
    expect(isCloseGateItem("toString")).toBe(false);
  });
});

describe("delivery ledger words", () => {
  it("maps channels and statuses to operator words", () => {
    expect(channelWord("push")).toBe("Push");
    expect(channelWord("in_app")).toBe("In app");
    expect(channelWord("sms")).toBe("Text");
    expect(channelWord("voice")).toBe("Voice call");
    expect(channelWord("carrier_pigeon")).toBe("Alert");
    expect(deliveryStatusWord("failed")).toBe("Did not go through");
    expect(deliveryStatusWord("acknowledged")).toBe("Acknowledged");
    expect(deliveryStatusWord("odd")).toBe("Recorded");
  });

  it("explains skip reasons", () => {
    expect(deliverySkipReasonLine("channel_not_enabled", "sms")).toBe("Text not enabled yet");
    expect(deliverySkipReasonLine("channel_not_enabled", "voice")).toBe("Voice call not enabled yet");
    expect(deliverySkipReasonLine("no_phone")).toBe("No phone on file");
    expect(deliverySkipReasonLine("acknowledged")).toBe("Acknowledged before sending");
    expect(deliverySkipReasonLine("route_paused")).toBe("Skipped: route paused");
    expect(deliverySkipReasonLine(null)).toBeNull();
  });

  it("names the target by person, then role, and never says nurse", () => {
    expect(deliveryTargetWord("Dana Whitfield", "facility_admin")).toBe("Dana Whitfield");
    expect(deliveryTargetWord(null, "facility_admin")).toBe("Administrator");
    expect(deliveryTargetWord(null, "on_call_primary")).toBe("On-call phone");
    expect(deliveryTargetWord(null, "charge_nurse")).toBe("Charge Administrator or Assistant");
    expect(deliveryTargetWord(null, null)).toBe("Administrator or Assistant");
  });
});

describe("time words", () => {
  it("formats clock time in the facility timezone", () => {
    expect(formatClockTime("2026-09-16T02:07:00.000Z", TZ)).toBe("10:07 PM");
    expect(formatClockTime("garbage", TZ)).toBeNull();
    expect(formatClockTime(null, TZ)).toBeNull();
  });

  it("says how long ago in whole units", () => {
    expect(formatTimeSince(new Date(T0 - 20_000).toISOString(), T0)).toBe("Just now");
    expect(formatTimeSince(new Date(T0 - 4 * 60_000).toISOString(), T0)).toBe("4 minutes ago");
    expect(formatTimeSince(new Date(T0 - 60 * 60_000).toISOString(), T0)).toBe("1 hour ago");
    expect(formatTimeSince(new Date(T0 - 3 * 3_600_000).toISOString(), T0)).toBe("3 hours ago");
    expect(formatTimeSince(new Date(T0 - 49 * 3_600_000).toISOString(), T0)).toBe("2 days ago");
    expect(formatTimeSince(null, T0)).toBe("No time posted");
    expect(formatTimeSince("nope", T0)).toBe("No time posted");
  });

  it("measures whole minutes and never goes negative", () => {
    expect(minutesBetween("2026-09-16T02:05:00.000Z", "2026-09-16T02:07:20.000Z")).toBe(2);
    expect(minutesBetween("2026-09-16T02:07:00.000Z", "2026-09-16T02:05:00.000Z")).toBe(0);
    expect(minutesBetween("bad", "2026-09-16T02:05:00.000Z")).toBe(0);
  });

  it("writes the acknowledgment and lowered-level lines", () => {
    expect(acknowledgedByLine("Dana Whitfield", "2026-09-16T02:07:00.000Z", TZ)).toBe(
      "Acknowledged by Dana Whitfield at 10:07 PM",
    );
    expect(acknowledgedByLine(null, null, TZ)).toBe("Acknowledged by the Administrator or Assistant");
    expect(loweredLevelLine(4, 3, "reassessed_on_scene")).toBe("Was Emergency, now Urgent, reason: Reassessed on scene");
  });
});
