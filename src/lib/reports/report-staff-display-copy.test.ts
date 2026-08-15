import { describe, expect, it } from "vitest";

import {
  REPORT_STAFF_NO_NAME_COPY,
  REPORT_STAFF_NO_STAFF_COPY,
  formatReportStaffMemberFromFields,
  formatReportStaffMemberFromMap,
} from "./report-staff-display-copy";

const EM_DASH = "—";

describe("formatReportStaffMemberFromMap", () => {
  it("names a missing staff id instead of Unknown", () => {
    const map = new Map<string, string>([["staff-1", "Jordan Lee"]]);
    expect(formatReportStaffMemberFromMap(null, map)).toBe(REPORT_STAFF_NO_STAFF_COPY);
    expect(formatReportStaffMemberFromMap(undefined, map)).toBe(REPORT_STAFF_NO_STAFF_COPY);
    expect(formatReportStaffMemberFromMap("", map)).toBe(REPORT_STAFF_NO_STAFF_COPY);
    expect(formatReportStaffMemberFromMap(null, map)).not.toBe("Unknown");
  });

  it("names a missing map hit instead of Unknown", () => {
    const map = new Map<string, string>([["staff-1", "Jordan Lee"]]);
    expect(formatReportStaffMemberFromMap("staff-missing", map)).toBe(REPORT_STAFF_NO_STAFF_COPY);
    expect(formatReportStaffMemberFromMap("staff-missing", map)).not.toBe("Unknown");
  });

  it("names a blank map value instead of inventing one", () => {
    const map = new Map<string, string>([["staff-1", ""]]);
    expect(formatReportStaffMemberFromMap("staff-1", map)).toBe(REPORT_STAFF_NO_NAME_COPY);
    expect(formatReportStaffMemberFromMap("staff-1", map)).not.toBe("Unknown");
  });

  it("names an em dash map value instead of a silent dash", () => {
    const map = new Map<string, string>([["staff-1", EM_DASH]]);
    expect(formatReportStaffMemberFromMap("staff-1", map)).toBe(REPORT_STAFF_NO_NAME_COPY);
    expect(formatReportStaffMemberFromMap("staff-1", map)).not.toBe(EM_DASH);
  });

  it("maps legacy Unknown map values to the named gap copy", () => {
    const map = new Map<string, string>([["staff-1", "Unknown"]]);
    expect(formatReportStaffMemberFromMap("staff-1", map)).toBe(REPORT_STAFF_NO_NAME_COPY);
    expect(formatReportStaffMemberFromMap("staff-1", map)).not.toBe("Unknown");
  });

  it("returns posted map names trimmed as-is", () => {
    const map = new Map<string, string>([["staff-1", "  Jordan Lee  "]]);
    expect(formatReportStaffMemberFromMap("staff-1", map)).toBe("Jordan Lee");
  });
});

describe("formatReportStaffMemberFromFields", () => {
  it("names a missing staff join instead of Unknown", () => {
    expect(formatReportStaffMemberFromFields(null)).toBe(REPORT_STAFF_NO_STAFF_COPY);
    expect(formatReportStaffMemberFromFields(undefined)).toBe(REPORT_STAFF_NO_STAFF_COPY);
    expect(formatReportStaffMemberFromFields(null)).not.toBe("Unknown");
  });

  it("names blank first/last fields instead of inventing one", () => {
    expect(formatReportStaffMemberFromFields({ first_name: null, last_name: null })).toBe(
      REPORT_STAFF_NO_NAME_COPY,
    );
    expect(formatReportStaffMemberFromFields({ first_name: "", last_name: "" })).toBe(
      REPORT_STAFF_NO_NAME_COPY,
    );
    expect(formatReportStaffMemberFromFields({ first_name: "   ", last_name: "  " })).toBe(
      REPORT_STAFF_NO_NAME_COPY,
    );
  });

  it("maps legacy Unknown field values to the named gap copy", () => {
    expect(formatReportStaffMemberFromFields({ first_name: "Unknown", last_name: null })).toBe(
      REPORT_STAFF_NO_NAME_COPY,
    );
    expect(formatReportStaffMemberFromFields({ first_name: "  Unknown  ", last_name: "" })).toBe(
      REPORT_STAFF_NO_NAME_COPY,
    );
    expect(formatReportStaffMemberFromFields({ first_name: "Unknown", last_name: null })).not.toBe(
      "Unknown",
    );
  });

  it("returns posted first and last names trimmed as-is", () => {
    expect(formatReportStaffMemberFromFields({ first_name: "Jordan", last_name: "Lee" })).toBe(
      "Jordan Lee",
    );
    expect(formatReportStaffMemberFromFields({ first_name: "  Jordan  ", last_name: "  Lee  " })).toBe(
      "Jordan Lee",
    );
  });
});
