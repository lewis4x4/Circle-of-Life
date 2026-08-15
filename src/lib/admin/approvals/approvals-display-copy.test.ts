import { describe, expect, it } from "vitest";

import {
  APPROVALS_NO_NAME_COPY,
  APPROVALS_NO_STAFF_COPY,
  formatApprovalsStaffName,
} from "./approvals-display-copy";

describe("formatApprovalsStaffName", () => {
  it("names a missing staff record instead of generic unknown copy", () => {
    expect(formatApprovalsStaffName(null)).toBe(APPROVALS_NO_STAFF_COPY);
    expect(formatApprovalsStaffName(undefined)).toBe(APPROVALS_NO_STAFF_COPY);
  });

  it("names a posted staff record with blank first and last names", () => {
    expect(formatApprovalsStaffName({ first_name: "", last_name: "" })).toBe(APPROVALS_NO_NAME_COPY);
    expect(formatApprovalsStaffName({ first_name: "  ", last_name: "" })).toBe(APPROVALS_NO_NAME_COPY);
    expect(formatApprovalsStaffName({ first_name: null, last_name: undefined })).toBe(
      APPROVALS_NO_NAME_COPY,
    );
  });

  it("returns a trimmed posted first name only", () => {
    expect(formatApprovalsStaffName({ first_name: "Jordan", last_name: "" })).toBe("Jordan");
    expect(formatApprovalsStaffName({ first_name: "  Jordan  ", last_name: "   " })).toBe("Jordan");
  });

  it("returns a trimmed posted last name only", () => {
    expect(formatApprovalsStaffName({ first_name: "", last_name: "Lee" })).toBe("Lee");
    expect(formatApprovalsStaffName({ first_name: "  ", last_name: "  Lee  " })).toBe("Lee");
  });

  it("returns trimmed posted first and last names joined with a single space", () => {
    expect(formatApprovalsStaffName({ first_name: "Jordan", last_name: "Lee" })).toBe("Jordan Lee");
    expect(formatApprovalsStaffName({ first_name: "  Jordan ", last_name: " Lee " })).toBe(
      "Jordan Lee",
    );
  });
});
