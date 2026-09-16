import { describe, expect, it } from "vitest";

import { isFacilityScopeLockedPath } from "./executive-facility-scope";

describe("isFacilityScopeLockedPath", () => {
  it("locks the executive overview on an exact path match", () => {
    expect(isFacilityScopeLockedPath("/admin/executive")).toBe(true);
  });

  it("leaves executive child routes unlocked — they are facility-scoped surfaces", () => {
    for (const child of [
      "/admin/executive/ceo",
      "/admin/executive/cfo",
      "/admin/executive/coo",
      "/admin/executive/facility",
      "/admin/executive/entity/entity-1",
      "/admin/executive/alerts",
      "/admin/executive/standup",
    ]) {
      expect(isFacilityScopeLockedPath(child)).toBe(false);
    }
  });

  it("does not lock on a trailing slash or a sibling prefix", () => {
    expect(isFacilityScopeLockedPath("/admin/executive/")).toBe(false);
    expect(isFacilityScopeLockedPath("/admin/executive-reports")).toBe(false);
  });

  it("leaves unrelated admin routes unlocked", () => {
    expect(isFacilityScopeLockedPath("/admin")).toBe(false);
    expect(isFacilityScopeLockedPath("/admin/residents")).toBe(false);
  });

  it("treats a missing pathname as unlocked", () => {
    expect(isFacilityScopeLockedPath(null)).toBe(false);
    expect(isFacilityScopeLockedPath(undefined)).toBe(false);
  });
});
