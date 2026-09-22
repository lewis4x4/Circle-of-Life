import { describe, expect, it } from "vitest";

import { assigneeLabel, isTask, noteCreateArgs } from "@/lib/home/notes";

const base = { id: "n-1", facilityId: "f-1", noteType: "maintenance" as const, body: "  Leak in 12 ", residentId: null, assignee: "", followUpDate: "" };

describe("Home notes (COL-595)", () => {
  it("is a task only with an assignee or a date", () => {
    expect(isTask(base)).toBe(false);
    expect(isTask({ ...base, followUpDate: "2026-09-23" })).toBe(true);
    expect(isTask({ ...base, assignee: "vendor:v-1" })).toBe(true);
  });
  it("splits a person or vendor assignee into the right column", () => {
    expect(noteCreateArgs({ ...base, assignee: "user:u-1" })).toMatchObject({ p_assignee_user_id: "u-1", p_assignee_vendor_id: null, p_body: "Leak in 12" });
    expect(noteCreateArgs({ ...base, assignee: "vendor:v-1" })).toMatchObject({ p_assignee_user_id: null, p_assignee_vendor_id: "v-1", p_follow_up_date: null });
  });
  it("names who holds a task", () => {
    expect(assigneeLabel({ kind: "queue" }, "me")).toBe("Facility queue");
    expect(assigneeLabel({ kind: "user", userId: "me", displayName: "Ada" }, "me")).toBe("Assigned to you");
    expect(assigneeLabel({ kind: "vendor", vendorId: "v", displayName: "Probe Plumbing" }, "me")).toBe("Vendor: Probe Plumbing");
  });
});
