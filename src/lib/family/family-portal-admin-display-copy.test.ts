import { describe, expect, it } from "vitest";

import {
  FAMILY_PORTAL_ADMIN_NO_KEYWORDS_COPY,
  FAMILY_PORTAL_ADMIN_NO_NOTE_COPY,
  FAMILY_PORTAL_ADMIN_NO_RESIDENT_NAME_COPY,
  FAMILY_PORTAL_ADMIN_NO_ROOM_COPY,
  FAMILY_PORTAL_ADMIN_SELECT_FACILITY_FIRST_COPY,
  familyPortalAdminKpiValue,
  formatFamilyPortalAdminConferenceRoom,
  formatFamilyPortalAdminMatchedKeywords,
  formatFamilyPortalAdminNoteBody,
  formatFamilyPortalAdminPageSubtitle,
  formatFamilyPortalAdminResidentName,
  resolveFamilyPortalAdminFacilityScope,
} from "./family-portal-admin-display-copy";

const EM_DASH = "—";

describe("formatFamilyPortalAdminNoteBody", () => {
  it("names a missing note body instead of an em dash", () => {
    expect(formatFamilyPortalAdminNoteBody(null)).toBe(FAMILY_PORTAL_ADMIN_NO_NOTE_COPY);
    expect(formatFamilyPortalAdminNoteBody("")).toBe(FAMILY_PORTAL_ADMIN_NO_NOTE_COPY);
    expect(formatFamilyPortalAdminNoteBody("   ")).toBe(FAMILY_PORTAL_ADMIN_NO_NOTE_COPY);
    expect(formatFamilyPortalAdminNoteBody(EM_DASH)).toBe(FAMILY_PORTAL_ADMIN_NO_NOTE_COPY);
  });

  it("returns a posted note body trimmed", () => {
    expect(formatFamilyPortalAdminNoteBody("Note A")).toBe("Note A");
    expect(formatFamilyPortalAdminNoteBody("  Note A  ")).toBe("Note A");
  });
});

describe("formatFamilyPortalAdminConferenceRoom", () => {
  it("names a missing room instead of an em dash", () => {
    expect(formatFamilyPortalAdminConferenceRoom(null)).toBe(FAMILY_PORTAL_ADMIN_NO_ROOM_COPY);
    expect(formatFamilyPortalAdminConferenceRoom("")).toBe(FAMILY_PORTAL_ADMIN_NO_ROOM_COPY);
    expect(formatFamilyPortalAdminConferenceRoom("   ")).toBe(FAMILY_PORTAL_ADMIN_NO_ROOM_COPY);
    expect(formatFamilyPortalAdminConferenceRoom(EM_DASH)).toBe(FAMILY_PORTAL_ADMIN_NO_ROOM_COPY);
  });

  it("returns a posted room id trimmed", () => {
    expect(formatFamilyPortalAdminConferenceRoom("Room 12")).toBe("Room 12");
    expect(formatFamilyPortalAdminConferenceRoom("  Room 12  ")).toBe("Room 12");
  });
});

describe("formatFamilyPortalAdminMatchedKeywords", () => {
  it("names missing keywords instead of an em dash", () => {
    expect(formatFamilyPortalAdminMatchedKeywords(null)).toBe(FAMILY_PORTAL_ADMIN_NO_KEYWORDS_COPY);
    expect(formatFamilyPortalAdminMatchedKeywords([])).toBe(FAMILY_PORTAL_ADMIN_NO_KEYWORDS_COPY);
  });

  it("joins posted keywords", () => {
    expect(formatFamilyPortalAdminMatchedKeywords(["fall", "pain"])).toBe("fall, pain");
  });
});

describe("formatFamilyPortalAdminResidentName", () => {
  it("names a missing resident instead of an em dash", () => {
    expect(formatFamilyPortalAdminResidentName(null)).toBe(FAMILY_PORTAL_ADMIN_NO_RESIDENT_NAME_COPY);
    expect(formatFamilyPortalAdminResidentName({ first_name: "", last_name: "" })).toBe(
      FAMILY_PORTAL_ADMIN_NO_RESIDENT_NAME_COPY,
    );
  });

  it("returns a posted resident name", () => {
    expect(formatFamilyPortalAdminResidentName({ first_name: "Resident", last_name: "A" })).toBe(
      "Resident A",
    );
  });
});

describe("familyPortalAdminKpiValue", () => {
  it("names missing facility scope instead of an em dash", () => {
    expect(familyPortalAdminKpiValue("pending_triage", false, 3)).toBe(
      "Select a facility to load triage counts",
    );
    expect(familyPortalAdminKpiValue("conferences_this_week", false, 2)).toBe(
      "Select a facility to load conferences",
    );
    expect(familyPortalAdminKpiValue("consents_expiring", false, 1)).toBe(
      "Select a facility to load consent counts",
    );
  });

  it("keeps numeric counts when facility scope is ready", () => {
    expect(familyPortalAdminKpiValue("pending_triage", true, 0)).toBe(0);
    expect(familyPortalAdminKpiValue("conferences_this_week", true, 4)).toBe(4);
  });
});

describe("resolveFamilyPortalAdminFacilityScope", () => {
  it("returns unscoped when facility scope is not ready", () => {
    expect(resolveFamilyPortalAdminFacilityScope(false, null)).toEqual({ kind: "unscoped" });
    expect(resolveFamilyPortalAdminFacilityScope(false, "Anon Facility A")).toEqual({
      kind: "unscoped",
    });
  });

  it("returns missing_name when facility is ready without a resolved name", () => {
    expect(resolveFamilyPortalAdminFacilityScope(true, null)).toEqual({ kind: "missing_name" });
    expect(resolveFamilyPortalAdminFacilityScope(true, "   ")).toEqual({ kind: "missing_name" });
  });

  it("returns a named scope when the facility name resolves", () => {
    expect(resolveFamilyPortalAdminFacilityScope(true, "Anon Facility A")).toEqual({
      kind: "named",
      name: "Anon Facility A",
    });
  });
});

describe("formatFamilyPortalAdminPageSubtitle", () => {
  it("uses the shared select-facility gap when unscoped", () => {
    expect(formatFamilyPortalAdminPageSubtitle({ kind: "unscoped" })).toContain(
      FAMILY_PORTAL_ADMIN_SELECT_FACILITY_FIRST_COPY,
    );
    expect(formatFamilyPortalAdminPageSubtitle({ kind: "unscoped" })).not.toContain("selected facility");
  });

  it("interpolates the facility name only when resolved", () => {
    expect(
      formatFamilyPortalAdminPageSubtitle({ kind: "named", name: "Anon Facility A" }),
    ).toContain("Family Connections at Anon Facility A.");
  });

  it("never interpolates a missing-name gap into an at-facility sentence", () => {
    const subtitle = formatFamilyPortalAdminPageSubtitle({ kind: "missing_name" });
    expect(subtitle).not.toContain(" at ");
    expect(subtitle).not.toContain("selected facility");
    expect(subtitle).toMatch(/^Family Connections\./);
  });
});
