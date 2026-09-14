import { describe, expect, it } from "vitest";
import { deliveryNotice, deliveryReason, instantFrom, localTimeRefusal, resolveLocalInstant, type CommandReply } from "./source-command";

const record = { id: "00000000-0000-4000-8000-000000000001" };

function reply(over: Partial<CommandReply>): CommandReply {
  return { outcome: "record", record, delivery: null, linked: false, replayed: false, ...over } as CommandReply;
}

describe("instantFrom", () => {
  it("converts a real local time to its instant", () => {
    expect(instantFrom("2026-09-10T09:30", "America/New_York")).toBe("2026-09-10T13:30:00.000Z");
  });

  it("refuses a nonexistent daylight-saving local time instead of moving it", () => {
    // fromZonedTime maps 02:30 to an instant that reads back as 01:30. Storing
    // it would record an hour nobody chose, so the spring-forward hole is
    // refused the way task-reminder.tsx and work-inputs.tsx already refuse it.
    expect(instantFrom("2026-03-08T02:30", "America/New_York")).toBeNull();
    expect(instantFrom("2026-03-08T02:00", "America/New_York")).toBeNull();
  });

  it("still accepts the repeated fall-back hour, which does exist", () => {
    expect(instantFrom("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("refuses an unparseable value rather than throwing", () => {
    expect(instantFrom("not a time", "America/New_York")).toBeNull();
  });

  it("accepts a time carrying seconds, which the time input can produce", () => {
    // DateTimeInput composes its value from <input type="time" step="any">, so
    // a real entry may arrive as HH:mm:ss or with a fraction. Comparing the
    // whole string against an HH:mm render would refuse a perfectly good time.
    expect(instantFrom("2026-09-10T09:30:00", "America/New_York")).toBe("2026-09-10T13:30:00.000Z");
    expect(instantFrom("2026-09-10T09:30:00.000", "America/New_York")).toBe("2026-09-10T13:30:00.000Z");
  });

  it("still refuses the daylight-saving hole when the value carries seconds", () => {
    expect(instantFrom("2026-03-08T02:30:00", "America/New_York")).toBeNull();
  });
});

describe("resolveLocalInstant", () => {
  it("tells a nonexistent clock time apart from an unfinished one", () => {
    // Both used to be one null, and both were blamed on daylight saving. A
    // half-filled field is a different mistake and gets a different sentence.
    expect(resolveLocalInstant("2026-03-08T02:30", "America/New_York")).toEqual({ problem: "impossible" });
    expect(resolveLocalInstant("T09:30", "America/New_York")).toEqual({ problem: "incomplete" });
    expect(resolveLocalInstant("2026-09-10T", "America/New_York")).toEqual({ problem: "incomplete" });
    expect(resolveLocalInstant("", "America/New_York")).toEqual({ problem: "incomplete" });
    expect(resolveLocalInstant("not a time", "America/New_York")).toEqual({ problem: "incomplete" });
  });

  it("does not blame daylight saving for a missing date", () => {
    const refusal = localTimeRefusal((resolveLocalInstant("T09:30", "America/New_York") as { problem: "incomplete" | "impossible" }).problem);
    expect(refusal).toMatch(/Enter both a date and a time/);
    expect(refusal).not.toMatch(/clocks move forward/);
  });

  it("names daylight saving only for the hour that does not exist", () => {
    const refusal = localTimeRefusal((resolveLocalInstant("2026-03-08T02:30", "America/New_York") as { problem: "incomplete" | "impossible" }).problem);
    expect(refusal).toMatch(/clocks move forward/);
  });

  it("returns the instant for a real local time", () => {
    expect(resolveLocalInstant("2026-09-10T09:30", "America/New_York")).toEqual({ instant: "2026-09-10T13:30:00.000Z" });
  });
});

describe("deliveryReason", () => {
  it("reads the database's own refusal reason and detail off the delivery", () => {
    expect(deliveryReason({ event: { state: "refused", reason: "recorder_not_authorized", detail: "Source author is not on the published recorder list for this activity" } })).toEqual({
      reason: "recorder_not_authorized",
      detail: "Source author is not on the published recorder list for this activity",
    });
  });

  it("returns nothing when there is no delivery or no reason to read", () => {
    expect(deliveryReason(null)).toBeNull();
    expect(deliveryReason({})).toBeNull();
    expect(deliveryReason({ event: { state: "satisfied" } })).toBeNull();
  });
});

describe("deliveryNotice", () => {
  it("states a satisfied delivery once", () => {
    expect(deliveryNotice(reply({ linked: true, delivery: { event: { state: "satisfied" } } }))).toMatch(/satisfied its matching requirement once/);
  });

  it("never says the requirement was missing when the recorder was refused", () => {
    // Migration 358 refuses an unauthorised recorder while the record stands
    // final. link_reason is only ever set when there is no delivery at all, so
    // this reason lives on the delivery and nowhere else.
    const notice = deliveryNotice(
      reply({ linked: false, delivery: { event: { state: "refused", reason: "recorder_not_authorized", detail: "Source author is not on the published recorder list for this activity" } } }),
    );
    expect(notice).toMatch(/recorder_not_authorized/);
    expect(notice).toMatch(/not on the published recorder list/);
    expect(notice).not.toMatch(/no matching requirement was found/);
  });

  it("keeps stating the no-activity reason the database sends without a delivery", () => {
    expect(deliveryNotice(reply({ linked: false, delivery: null, link_reason: "no_checklist_activity" }))).toMatch(/did not link: no_checklist_activity/);
  });

  it("falls back to the generic sentence only when the reply carries no reason at all", () => {
    expect(deliveryNotice(reply({ linked: false, delivery: null }))).toMatch(/no matching requirement was found for it/);
  });

  it("reports an unmatched delivery by its real reason", () => {
    const notice = deliveryNotice(reply({ linked: false, delivery: { event: { state: "unmatched", reason: "no_candidate" } } }));
    expect(notice).toMatch(/did not link: no_candidate/);
  });
});
