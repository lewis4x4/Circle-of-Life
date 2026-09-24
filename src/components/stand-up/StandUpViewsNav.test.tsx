import { describe, expect, it } from "vitest";

import { activeStandUpView, STAND_UP_VIEWS } from "@/components/stand-up/StandUpViewsNav";

describe("Stand Up views (COL-707)", () => {
  it("lights the most specific view", () => {
    expect(activeStandUpView("/admin/stand-up")).toBe("/admin/stand-up");
    expect(activeStandUpView("/admin/executive/standup")).toBe("/admin/executive/standup");
    expect(activeStandUpView("/admin/executive/standup/2026-09-21/board")).toBe("/admin/executive/standup");
    expect(activeStandUpView("/admin/executive/standup/history")).toBe("/admin/executive/standup/history");
    expect(activeStandUpView("/admin/executive")).toBeUndefined();
  });

  it("offers the facility form first and the roll-up beside it", () => {
    expect(STAND_UP_VIEWS.map((v) => v.href).slice(0, 2)).toEqual(["/admin/stand-up", "/admin/executive/standup"]);
  });
});
