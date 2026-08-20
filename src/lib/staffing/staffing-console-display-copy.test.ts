import { describe, expect, it } from "vitest";

import {
  STAFFING_CONSOLE_NO_RATIO_COPY,
  STAFFING_CONSOLE_NO_STAFF_COPY,
  formatStaffingConsoleCurrentRatioMainValue,
  formatStaffingConsoleExpiredCertStaffName,
  staffingConsoleCurrentRatioMainIsNumeric,
} from "./staffing-console-display-copy";

const EM_DASH = "—";
const EN_DASH = "–";
const DOUBLE_HYPHEN = "--";

describe("formatStaffingConsoleCurrentRatioMainValue", () => {
  it("names a missing ratio instead of a dash glyph", () => {
    expect(formatStaffingConsoleCurrentRatioMainValue(null)).toBe(STAFFING_CONSOLE_NO_RATIO_COPY);
    expect(formatStaffingConsoleCurrentRatioMainValue(undefined)).toBe(STAFFING_CONSOLE_NO_RATIO_COPY);
    expect(formatStaffingConsoleCurrentRatioMainValue(null)).not.toBe(EM_DASH);
    expect(formatStaffingConsoleCurrentRatioMainValue(null)).not.toBe(EN_DASH);
    expect(formatStaffingConsoleCurrentRatioMainValue(null)).not.toBe(DOUBLE_HYPHEN);
  });

  it("keeps a posted zero as numeric zero", () => {
    expect(formatStaffingConsoleCurrentRatioMainValue(0)).toBe(0);
    expect(formatStaffingConsoleCurrentRatioMainValue(0)).not.toBe(STAFFING_CONSOLE_NO_RATIO_COPY);
    expect(formatStaffingConsoleCurrentRatioMainValue(0)).not.toBe(EM_DASH);
  });

  it("returns a posted ratio as a number", () => {
    expect(formatStaffingConsoleCurrentRatioMainValue(8.4)).toBe(8.4);
    expect(formatStaffingConsoleCurrentRatioMainValue(8.4)).not.toBe(EM_DASH);
  });
});

describe("staffingConsoleCurrentRatioMainIsNumeric", () => {
  it("flags numeric main values only", () => {
    expect(staffingConsoleCurrentRatioMainIsNumeric(0)).toBe(true);
    expect(staffingConsoleCurrentRatioMainIsNumeric(8.4)).toBe(true);
    expect(staffingConsoleCurrentRatioMainIsNumeric(STAFFING_CONSOLE_NO_RATIO_COPY)).toBe(false);
  });
});

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
