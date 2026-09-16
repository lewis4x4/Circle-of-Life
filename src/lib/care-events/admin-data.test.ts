import { describe, expect, it } from "vitest";

import type { Database } from "@/types/database";

import {
  deliveryLedgerWords,
  describeAdminSectionError,
  parseAdminAnswers,
  parseAdminSectionResult,
  parseAttachments,
  parseCareEventStatus,
  parseFlags,
  toDeliveryLine,
} from "./admin-data";

const TZ = "America/New_York";

type DeliveryRow = Database["public"]["Tables"]["care_event_deliveries"]["Row"];

function deliveryRow(overrides: Partial<DeliveryRow> = {}): DeliveryRow {
  return {
    id: "d1",
    care_event_id: "ce1",
    organization_id: "org",
    facility_id: "fac",
    channel: "push",
    status: "sent",
    escalation_step: 0,
    target_user_id: "u1",
    target_role: "facility_admin",
    target_phone: null,
    send_after: "2026-09-16T02:05:00.000Z",
    sent_at: "2026-09-16T02:05:10.000Z",
    acknowledged_at: null,
    skip_reason: null,
    error_message: null,
    provider_message_id: null,
    created_at: "2026-09-16T02:05:00.000Z",
    ...overrides,
  };
}

describe("answers and flags", () => {
  it("reads the admin stamps out of answers.admin", () => {
    const admin = parseAdminAnswers({
      hurt: "a_little",
      admin: {
        family_notified_at: "2026-09-16T02:10:00.000Z",
        family_later: false,
        physician_later: true,
        ems: "none",
        corrective_actions: ["care_plan_review", 4, "other"],
        corrective_other: "Bed rail replaced",
        ahca_reportable: false,
        video_secured: "na",
      },
    });
    expect(admin).toEqual({
      familyNotifiedAt: "2026-09-16T02:10:00.000Z",
      familyLater: false,
      physicianNotifiedAt: null,
      physicianLater: true,
      ems: "none",
      correctiveActions: ["care_plan_review", "other"],
      correctiveOther: "Bed rail replaced",
      ahcaReportable: false,
      ahcaReason: null,
      dcfReportedAt: null,
      videoSecured: "na",
    });
  });

  it("is empty when there is no admin object", () => {
    expect(parseAdminAnswers({ hurt: "not_hurt" }).ahcaReportable).toBeNull();
    expect(parseAdminAnswers(null).correctiveActions).toEqual([]);
    expect(parseAdminAnswers("text").familyLater).toBe(false);
  });

  it("keeps only string attachment paths", () => {
    expect(parseAttachments({ attachments: ["org/fac/ce/a.jpg", 7, null] })).toEqual(["org/fac/ce/a.jpg"]);
    expect(parseAttachments({})).toEqual([]);
  });

  it("parses flags as booleans with false defaults", () => {
    const flags = parseFlags({ ahca_reportable: true, dcf_report_required: "yes", extra: true });
    expect(flags.ahca_reportable).toBe(true);
    expect(flags.dcf_report_required).toBe(false);
    expect(flags.neuro_checks).toBe(false);
    expect("extra" in flags).toBe(false);
  });

  it("narrows the status", () => {
    expect(parseCareEventStatus("acknowledged")).toBe("acknowledged");
    expect(parseCareEventStatus("closed")).toBe("closed");
    expect(parseCareEventStatus("weird")).toBe("open");
  });
});

describe("close gate result", () => {
  it("reads status, level, and the missing list", () => {
    expect(
      parseAdminSectionResult({ status: "acknowledged", final_level: 3, missing: ["family_notified", "bogus", "ahca_decision"] }),
    ).toEqual({ status: "acknowledged", finalLevel: 3, missing: ["family_notified", "ahca_decision"] });
  });

  it("defaults safely on garbage", () => {
    expect(parseAdminSectionResult(null)).toEqual({ status: "open", finalLevel: 1, missing: [] });
    expect(parseAdminSectionResult("x")).toEqual({ status: "open", finalLevel: 1, missing: [] });
  });
});

describe("delivery ledger", () => {
  it("joins the target name and writes the row in words", () => {
    const line = toDeliveryLine(deliveryRow(), new Map([["u1", "Dana Whitfield"]]));
    expect(line.targetName).toBe("Dana Whitfield");
    expect(deliveryLedgerWords(line, TZ)).toEqual({
      target: "Dana Whitfield",
      channel: "Push",
      status: "Sent",
      time: "10:05 PM",
      note: null,
    });
  });

  it("uses the acknowledged time for acknowledged rows", () => {
    const line = toDeliveryLine(
      deliveryRow({ status: "acknowledged", acknowledged_at: "2026-09-16T02:07:00.000Z" }),
      new Map(),
    );
    expect(deliveryLedgerWords(line, TZ)).toMatchObject({ target: "Administrator", status: "Acknowledged", time: "10:07 PM" });
  });

  it("explains skipped rows", () => {
    const skipped = toDeliveryLine(
      deliveryRow({ channel: "sms", status: "skipped", skip_reason: "channel_not_enabled", sent_at: null, target_role: "on_call_primary", target_user_id: null }),
      new Map(),
    );
    expect(deliveryLedgerWords(skipped, TZ)).toEqual({
      target: "On-call phone",
      channel: "Text",
      status: "Skipped",
      time: null,
      note: "Text not enabled yet",
    });
    const cancelled = toDeliveryLine(deliveryRow({ status: "skipped", skip_reason: "acknowledged", sent_at: null }), new Map());
    expect(deliveryLedgerWords(cancelled, TZ).note).toBe("Acknowledged before sending");
  });
});

describe("error lines", () => {
  it("turns the function's messages into operator words", () => {
    expect(describeAdminSectionError(new Error("care_event: close gate: family_notified"))).toBe("The close gate is not met yet.");
    expect(describeAdminSectionError(new Error("care_event: the new level must be lower than the current level"))).toBe(
      "Pick a level below the current one.",
    );
    expect(describeAdminSectionError(new Error("care_event: a reason is required to lower the level"))).toBe(
      "Pick a reason before lowering the level.",
    );
    expect(describeAdminSectionError(new Error("care_event: forbidden"))).toBe("Completion is for the Administrator or Assistant.");
    expect(describeAdminSectionError({})).toBe("That did not save. Try again.");
  });
});
