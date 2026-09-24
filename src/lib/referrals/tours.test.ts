import { describe, expect, it } from "vitest";

import {
  buildRescheduleTourCommand,
  buildTourResultCommand,
  countedTours,
  describeTourEvent,
  emptyScheduleTourDraft,
  emptyTourResultDraft,
  tourOutcomeLabel,
  tourStateLabel,
  validateRescheduleTourDraft,
  validateTourResultDraft,
} from "@/lib/referrals/tours";

describe("referral tours (COL-332)", () => {
  it("counts a reschedule chain once and each real tour once", () => {
    const tours = [
      { id: "a", outcome: "rescheduled" as const },
      { id: "b", outcome: "rescheduled" as const },
      { id: "c", outcome: "completed" as const },
      { id: "d", outcome: "scheduled" as const },
      { id: "e", outcome: "no_show" as const },
    ];
    expect(countedTours(tours).map((tour) => tour.id)).toEqual(["c", "d", "e"]);
  });

  it("words every result for staff, and says when a past tour has no result", () => {
    expect(tourOutcomeLabel("no_show")).toBe("No-show");
    expect(tourOutcomeLabel("completed")).toBe("Completed");
    const now = new Date("2026-09-24T12:00:00Z");
    expect(tourStateLabel({ outcome: "scheduled", scheduled_for: "2026-09-20T14:00:00Z" }, now)).toBe("Result not recorded");
    expect(tourStateLabel({ outcome: "scheduled", scheduled_for: "2026-10-01T14:00:00Z" }, now)).toBe("Scheduled");
  });

  it("opens every form empty", () => {
    expect(emptyScheduleTourDraft()).toEqual({ scheduledFor: "", ownerUserId: "" });
    expect(emptyTourResultDraft()).toEqual({ outcome: "", completedAt: "", feedback: "" });
  });

  it("refuses a completion in the future and a reschedule with no one to give it", () => {
    const now = new Date("2026-09-24T12:00:00Z");
    expect(validateTourResultDraft({ outcome: "completed", completedAt: "2026-09-25T09:00", feedback: "" }, now).completedAt).toBe(
      "A completed tour cannot finish in the future.",
    );
    expect(validateTourResultDraft({ outcome: "no_show", completedAt: "", feedback: "" }, now)).toEqual({});
    expect(validateRescheduleTourDraft({ scheduledFor: "2026-10-01T10:00", ownerUserId: "", note: "" }, { owner_user_id: null }).ownerUserId).toBe(
      "Choose who gives the tour.",
    );
    expect(validateRescheduleTourDraft({ scheduledFor: "2026-10-01T10:00", ownerUserId: "", note: "" }, { owner_user_id: "u" })).toEqual({});
  });

  it("converts Eastern wall-clock times across the DST change and sends only what was entered", () => {
    // 2026-11-01 is the fall-back day: 10:00 EST is 15:00 UTC; the day before, 10:00 EDT is 14:00 UTC.
    expect(buildRescheduleTourCommand("t1", { scheduledFor: "2026-11-02T10:00", ownerUserId: "", note: " " })).toEqual({
      kind: "reschedule",
      tour_id: "t1",
      scheduled_for: "2026-11-02T15:00:00.000Z",
    });
    expect(buildRescheduleTourCommand("t1", { scheduledFor: "2026-10-31T10:00", ownerUserId: "u2", note: "" }).scheduled_for).toBe(
      "2026-10-31T14:00:00.000Z",
    );
    expect(buildTourResultCommand("t1", { outcome: "cancelled", completedAt: "2026-09-20T10:00", feedback: "" })).toEqual({
      kind: "record_outcome",
      tour_id: "t1",
      outcome: "cancelled",
    });
  });

  it("describes tour history entries", () => {
    expect(describeTourEvent({ action: "reschedule", previous_scheduled_for: "2026-09-18T14:00:00Z", scheduled_for: "2026-09-20T14:00:00Z", owner_name: "Robin Recruiter" }).title).toBe(
      "Tour rescheduled",
    );
    expect(describeTourEvent({ action: "record_outcome", outcome: "completed", completed_at: "2026-09-20T15:00:00Z" }).title).toBe(
      "Tour result: Completed",
    );
  });
});
