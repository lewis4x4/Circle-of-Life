import { describe, expect, it } from "vitest";

import {
  USER_TABLE_NO_PRIMARY_FACILITY_COPY,
  formatUserTablePrimaryFacilitiesDisplay,
} from "./user-table-display-copy";

const EM_DASH = "—";

describe("formatUserTablePrimaryFacilitiesDisplay", () => {
  it("names no facilities instead of an em dash", () => {
    expect(formatUserTablePrimaryFacilitiesDisplay([])).toBe(USER_TABLE_NO_PRIMARY_FACILITY_COPY);
    expect(formatUserTablePrimaryFacilitiesDisplay(null)).toBe(USER_TABLE_NO_PRIMARY_FACILITY_COPY);
    expect(formatUserTablePrimaryFacilitiesDisplay(undefined)).toBe(
      USER_TABLE_NO_PRIMARY_FACILITY_COPY,
    );
    expect(formatUserTablePrimaryFacilitiesDisplay([])).not.toBe(EM_DASH);
  });

  it("names no primary facility when only non-primary facilities exist", () => {
    expect(
      formatUserTablePrimaryFacilitiesDisplay([
        { facility_name: "Oakridge ALF", is_primary: false },
        { facility_name: "Homewood Lodge", is_primary: false },
      ]),
    ).toBe(USER_TABLE_NO_PRIMARY_FACILITY_COPY);
  });

  it("returns a single primary facility name", () => {
    expect(
      formatUserTablePrimaryFacilitiesDisplay([
        { facility_name: "Oakridge ALF", is_primary: true },
        { facility_name: "Homewood Lodge", is_primary: false },
      ]),
    ).toBe("Oakridge ALF");
  });

  it("joins several primary facility names with a comma", () => {
    expect(
      formatUserTablePrimaryFacilitiesDisplay([
        { facility_name: "Oakridge ALF", is_primary: true },
        { facility_name: "Homewood Lodge", is_primary: true },
        { facility_name: "Plantation", is_primary: false },
      ]),
    ).toBe("Oakridge ALF, Homewood Lodge");
  });

  it("treats blank primary facility names as missing", () => {
    expect(
      formatUserTablePrimaryFacilitiesDisplay([
        { facility_name: "   ", is_primary: true },
        { facility_name: "", is_primary: true },
      ]),
    ).toBe(USER_TABLE_NO_PRIMARY_FACILITY_COPY);
  });
});
