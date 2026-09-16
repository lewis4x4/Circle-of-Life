import { describe, expect, it } from "vitest";

import {
  buildIncidentAcknowledgmentLine,
  buildIncidentOpenObligations,
  type IncidentObligationInput,
  type IncidentWorkflowObligationShape,
  type ObligationCareEvent,
  type ObligationDelivery,
} from "./workflow-obligations";

const TZ = "America/New_York";
const CREATED = "2026-09-16T02:05:00.000Z"; // 10:05 PM Eastern

function incident(overrides: Partial<IncidentWorkflowObligationShape> = {}): IncidentWorkflowObligationShape {
  return {
    severity: "level_3",
    nurse_notified: false,
    administrator_notified: false,
    owner_notified: false,
    physician_notified: false,
    family_notified: false,
    ahca_reportable: false,
    ahca_reported: false,
    insurance_reportable: false,
    insurance_reported: false,
    ...overrides,
  };
}

function careEvent(overrides: Partial<ObligationCareEvent> = {}): ObligationCareEvent {
  return {
    id: "ce1",
    status: "open",
    created_at: CREATED,
    acknowledged_at: null,
    acknowledged_by: null,
    final_level: "level_3",
    admin: null,
    ...overrides,
  };
}

function delivery(overrides: Partial<ObligationDelivery> = {}): ObligationDelivery {
  return {
    target_user_id: "admin-1",
    channel: "push",
    status: "sent",
    escalation_step: 0,
    send_after: CREATED,
    sent_at: "2026-09-16T02:05:05.000Z",
    acknowledged_at: null,
    ...overrides,
  };
}

function input(overrides: Partial<IncidentObligationInput> = {}): IncidentObligationInput {
  return { incident: incident(), routes: [], deliveries: [], careEvent: null, timeZone: TZ, ...overrides };
}

describe("acknowledged care event", () => {
  it("writes the acknowledgment line from the ledger and drops it from the open list", () => {
    const acknowledged = careEvent({
      status: "acknowledged",
      acknowledged_at: "2026-09-16T02:07:00.000Z",
      acknowledged_by: "admin-1",
    });
    const deliveries = [delivery({ channel: "in_app" }), delivery({ channel: "push", sent_at: "2026-09-16T02:05:02.000Z" })];
    const built = input({ careEvent: acknowledged, deliveries });
    expect(buildIncidentAcknowledgmentLine(built)).toBe("Administrator acknowledged 10:07 PM (push, 2 min)");
    expect(buildIncidentOpenObligations(built)).toEqual([
      "Physician decision pending",
      "Family decision pending",
      "AHCA decision pending",
    ]);
  });

  it("omits the channel when the ledger has no sent row for the acknowledging user", () => {
    const built = input({
      careEvent: careEvent({ status: "acknowledged", acknowledged_at: "2026-09-16T02:08:00.000Z", acknowledged_by: "admin-2" }),
      deliveries: [delivery()],
    });
    expect(buildIncidentAcknowledgmentLine(built)).toBe("Administrator acknowledged 10:08 PM (3 min)");
  });

  it("clears the decisions once stamped, including the Later answers", () => {
    const built = input({
      incident: incident({ physician_notified: true, ahca_reportable: true, ahca_reported: false, insurance_reportable: true }),
      careEvent: careEvent({
        status: "acknowledged",
        acknowledged_at: "2026-09-16T02:07:00.000Z",
        acknowledged_by: "admin-1",
        admin: { familyLater: true, ahcaReportable: true },
      }),
    });
    expect(buildIncidentOpenObligations(built)).toEqual(["AHCA report pending", "Report to the insurance carrier"]);
  });

  it("asks nothing of a Heads-up beyond acknowledgment", () => {
    const built = input({
      incident: incident({ severity: "level_2" }),
      careEvent: careEvent({ final_level: "level_2", status: "acknowledged", acknowledged_at: "2026-09-16T02:07:00.000Z" }),
    });
    expect(buildIncidentOpenObligations(built)).toEqual([]);
  });
});

describe("not yet acknowledged care event", () => {
  it("says so plainly when only step 0 has gone out", () => {
    const built = input({ careEvent: careEvent(), deliveries: [delivery()] });
    expect(buildIncidentAcknowledgmentLine(built)).toBeNull();
    expect(buildIncidentOpenObligations(built)[0]).toBe("Administrator not yet acknowledged");
  });

  it("names the escalation time once a step 1 row was sent", () => {
    const built = input({
      careEvent: careEvent(),
      deliveries: [
        delivery(),
        delivery({ escalation_step: 1, channel: "sms", target_user_id: null, sent_at: "2026-09-16T02:16:00.000Z" }),
      ],
    });
    expect(buildIncidentOpenObligations(built)[0]).toBe("Administrator not yet acknowledged (escalated to on-call 10:16 PM)");
  });

  it("names the queued time when step 1 is scheduled but not sent", () => {
    const built = input({
      careEvent: careEvent(),
      deliveries: [
        delivery(),
        delivery({ escalation_step: 1, channel: "sms", status: "queued", sent_at: null, send_after: "2026-09-16T02:15:00.000Z" }),
      ],
    });
    expect(buildIncidentOpenObligations(built)[0]).toBe("Administrator not yet acknowledged (on-call alert queued for 10:15 PM)");
  });

  it("ignores cancelled escalation rows", () => {
    const built = input({
      careEvent: careEvent(),
      deliveries: [delivery({ escalation_step: 1, status: "skipped", sent_at: null, send_after: "2026-09-16T02:15:00.000Z" })],
    });
    expect(buildIncidentOpenObligations(built)[0]).toBe("Administrator not yet acknowledged");
  });

  it("flags a level no route covers when nothing has been delivered", () => {
    const built = input({
      careEvent: careEvent(),
      routes: [{ name: "Owner", severity_min: "level_4" }],
    });
    expect(buildIncidentOpenObligations(built)[0]).toBe(
      "Administrator not yet acknowledged (no alert route covers this level; tell the Administrator or Assistant in person)",
    );
  });

  it("does not ask for acknowledgment on a Note", () => {
    const built = input({ incident: incident({ severity: "level_1" }), careEvent: careEvent({ final_level: "level_1" }) });
    expect(buildIncidentOpenObligations(built)).toEqual([]);
  });
});

describe("legacy incidents without a care event", () => {
  it("keeps the manual flags and never says nurse", () => {
    const lines = buildIncidentOpenObligations(input({ incident: incident({ ahca_reportable: true, insurance_reportable: true }) }));
    expect(lines).toEqual([
      "Notify the Administrator or Assistant.",
      "Notify the owner.",
      "Notify the physician.",
      "Notify the family.",
      "Complete AHCA reporting.",
      "Report to the insurance carrier.",
    ]);
    expect(lines.join(" ")).not.toMatch(/nurse/i);
    expect(buildIncidentAcknowledgmentLine(input())).toBeNull();
  });

  it("drops the administrator line once the flag is set and skips the level 3 lines on a level 2", () => {
    expect(buildIncidentOpenObligations(input({ incident: incident({ severity: "level_2", administrator_notified: true }) }))).toEqual([]);
    expect(
      buildIncidentOpenObligations(
        input({ incident: incident({ severity: "level_2", administrator_notified: true, nurse_notified: false, ahca_reportable: true, ahca_reported: true }) }),
      ),
    ).toEqual([]);
  });
});
