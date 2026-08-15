import { describe, expect, it } from "vitest";

import {
  STAFFING_CONSOLE_NO_STAFF_COPY,
  formatStaffingConsoleExpiredCertStaffName,
} from "./staffing-console-display-copy";

describe("formatStaffingConsoleExpiredCertStaffName", () => {
  it("names missing or blank staff instead of generic unknown copy", () => {
    expect(formatStaffingConsoleExpiredCertStaffName(null)).toBe(STAFFING_CONSOLE_NO_STAFF_COPY);
    expect(formatStaffingConsoleExpiredCertStaffName(undefined)).toBe(
      STAFFING_CONSOLE_NO_STAFF_COPY,
    );
    expect(formatStaffingConsoleExpiredCertStaffName({ first_name: "", last_name: "" })).toBe(
      STAFFING_CONSOLE_NO_STAFF_COPY,
    );
    expect(formatStaffingConsoleExpiredCertStaffName({ first_name: "  ", last_name: "" })).toBe(
      STAFFING_CONSOLE_NO_STAFF_COPY,
    );
    expect(formatStaffingConsoleExpiredCertStaffName(null)).not.toBe("Unknown staff");
  });

  it("returns a posted first name only", () => {
    expect(formatStaffingConsoleExpiredCertStaffName({ first_name: "Jordan", last_name: "" })).toBe(
      "Jordan",
    );
    expect(
      formatStaffingConsoleExpiredCertStaffName({ first_name: "  Jordan  ", last_name: "" }),
    ).toBe("Jordan");
  });

  it("returns a posted last name only", () => {
    expect(formatStaffingConsoleExpiredCertStaffName({ first_name: "", last_name: "Lee" })).toBe(
      "Lee",
    );
    expect(
      formatStaffingConsoleExpiredCertStaffName({ first_name: "", last_name: "  Lee  " }),
    ).toBe("Lee");
  });

  it("returns posted first and last joined with a single space", () => {
    expect(
      formatStaffingConsoleExpiredCertStaffName({ first_name: "Jordan", last_name: "Lee" }),
    ).toBe("Jordan Lee");
    expect(
      formatStaffingConsoleExpiredCertStaffName({
        first_name: "  Jordan  ",
        last_name: "  Lee  ",
      }),
    ).toBe("Jordan Lee");
  });
});
