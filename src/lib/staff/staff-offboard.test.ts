import { describe, expect, it } from "vitest";

import {
  accessControlSyncOnOffboard,
  accessControlSyncOnReactivate,
  buildStaffOffboardPatch,
  buildStaffReactivatePatch,
  canOffboardStaff,
  canRestoreHavenLogin,
  decideOffboardHavenAccess,
  decideReactivateHavenAccess,
  employmentStatusCommandError,
  isInactiveEmploymentStatus,
  parseStaffOffboardRequest,
  parseStaffReactivateRequest,
} from "./staff-offboard";

describe("canOffboardStaff", () => {
  it("allows owner, org_admin, and facility_admin only", () => {
    expect(canOffboardStaff("owner")).toBe(true);
    expect(canOffboardStaff("org_admin")).toBe(true);
    expect(canOffboardStaff("facility_admin")).toBe(true);
    expect(canOffboardStaff("manager")).toBe(false);
    expect(canOffboardStaff("nurse")).toBe(false);
  });
});

describe("canRestoreHavenLogin", () => {
  it("limits Haven sign-in restore to org-wide administrators", () => {
    expect(canRestoreHavenLogin("owner")).toBe(true);
    expect(canRestoreHavenLogin("org_admin")).toBe(true);
    expect(canRestoreHavenLogin("facility_admin")).toBe(false);
  });
});

describe("isInactiveEmploymentStatus", () => {
  it("treats terminated and suspended as inactive", () => {
    expect(isInactiveEmploymentStatus("terminated")).toBe(true);
    expect(isInactiveEmploymentStatus("suspended")).toBe(true);
    expect(isInactiveEmploymentStatus("active")).toBe(false);
    expect(isInactiveEmploymentStatus("on_leave")).toBe(false);
  });
});

describe("parseStaffOffboardRequest", () => {
  it("accepts an empty body", () => {
    expect(parseStaffOffboardRequest(null)).toEqual({
      ok: true,
      reason: null,
      terminationDate: null,
    });
  });

  it("trims reason and keeps a calendar date", () => {
    expect(
      parseStaffOffboardRequest({ reason: "  left  ", termination_date: "2026-09-15" }),
    ).toEqual({ ok: true, reason: "left", terminationDate: "2026-09-15" });
  });

  it("rejects a long reason and a non-calendar date", () => {
    expect(parseStaffOffboardRequest({ reason: "x".repeat(501) }).ok).toBe(false);
    expect(parseStaffOffboardRequest({ termination_date: "09/15/2026" }).ok).toBe(false);
  });
});

describe("parseStaffReactivateRequest", () => {
  it("accepts a missing body and a short reason", () => {
    expect(parseStaffReactivateRequest(null)).toEqual({ ok: true, reason: null });
    expect(parseStaffReactivateRequest({ reason: "rehired" })).toEqual({
      ok: true,
      reason: "rehired",
    });
  });
});

describe("buildStaffOffboardPatch / buildStaffReactivatePatch", () => {
  it("soft-terminates without deleting the staff row", () => {
    expect(
      buildStaffOffboardPatch({
        updatedBy: "actor-1",
        terminationDate: "2026-09-15",
        reason: "end of assignment",
      }),
    ).toEqual({
      employment_status: "terminated",
      termination_date: "2026-09-15",
      termination_reason: "end of assignment",
      updated_by: "actor-1",
    });
  });

  it("restores active employment and clears termination fields", () => {
    expect(buildStaffReactivatePatch("actor-1")).toEqual({
      employment_status: "active",
      termination_date: null,
      termination_reason: null,
      updated_by: "actor-1",
    });
  });
});

describe("employmentStatusCommandError", () => {
  it("blocks casual terminate and casual restore", () => {
    expect(employmentStatusCommandError("active", "terminated")).toMatch(/Offboard/);
    expect(employmentStatusCommandError("terminated", "active")).toMatch(/Restore employment/);
    expect(employmentStatusCommandError("active", "on_leave")).toBeNull();
    expect(employmentStatusCommandError("terminated", "terminated")).toBeNull();
  });
});

describe("decideOffboardHavenAccess", () => {
  const linked = {
    id: "user-2",
    app_role: "caregiver",
    is_active: true,
    deleted_at: null,
  };

  it("skips Haven when no login is linked", () => {
    expect(
      decideOffboardHavenAccess({
        actorId: "admin-1",
        actorRole: "facility_admin",
        staffUserId: null,
        linkedUser: null,
      }),
    ).toEqual({ kind: "not_linked" });
  });

  it("refuses self-offboard", () => {
    expect(
      decideOffboardHavenAccess({
        actorId: "user-2",
        actorRole: "facility_admin",
        staffUserId: "user-2",
        linkedUser: { ...linked, app_role: "facility_admin" },
      }),
    ).toEqual({ kind: "self" });
  });

  it("refuses when the actor cannot manage the linked role", () => {
    expect(
      decideOffboardHavenAccess({
        actorId: "admin-1",
        actorRole: "facility_admin",
        staffUserId: "user-2",
        linkedUser: { ...linked, app_role: "owner" },
      }),
    ).toEqual({ kind: "cannot_manage", appRole: "owner" });
  });

  it("disables an active linked login the actor can manage", () => {
    expect(
      decideOffboardHavenAccess({
        actorId: "admin-1",
        actorRole: "facility_admin",
        staffUserId: "user-2",
        linkedUser: linked,
      }),
    ).toEqual({ kind: "disable", userId: "user-2" });
  });

  it("treats an already-disabled login as revoked", () => {
    expect(
      decideOffboardHavenAccess({
        actorId: "admin-1",
        actorRole: "org_admin",
        staffUserId: "user-2",
        linkedUser: { ...linked, is_active: false },
      }),
    ).toEqual({ kind: "already_revoked", userId: "user-2" });
  });
});

describe("decideReactivateHavenAccess", () => {
  it("asks an org admin to restore login when a facility admin reactivates", () => {
    expect(
      decideReactivateHavenAccess({
        actorRole: "facility_admin",
        staffUserId: "user-2",
        linkedUser: {
          id: "user-2",
          app_role: "caregiver",
          is_active: false,
          deleted_at: null,
        },
      }),
    ).toEqual({ kind: "needs_org_admin", userId: "user-2" });
  });

  it("restores login for an org admin", () => {
    expect(
      decideReactivateHavenAccess({
        actorRole: "org_admin",
        staffUserId: "user-2",
        linkedUser: {
          id: "user-2",
          app_role: "caregiver",
          is_active: false,
          deleted_at: null,
        },
      }),
    ).toEqual({ kind: "reactivate", userId: "user-2" });
  });
});

describe("access-control sync flags", () => {
  it("queues physical access-control follow-up on offboard and clears on restore", () => {
    expect(accessControlSyncOnOffboard()).toBe("queued");
    expect(accessControlSyncOnReactivate()).toBe("cleared");
  });
});
