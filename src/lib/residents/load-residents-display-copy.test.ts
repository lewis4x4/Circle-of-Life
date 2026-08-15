import { describe, expect, it } from "vitest";

import {
  LOAD_RESIDENTS_NO_NAME_COPY,
  formatLoadResidentsFullName,
} from "./load-residents-display-copy";

describe("formatLoadResidentsFullName", () => {
  it("names the gap when first and last are blank or whitespace", () => {
    expect(formatLoadResidentsFullName(null, null)).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
    expect(formatLoadResidentsFullName("", "")).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
    expect(formatLoadResidentsFullName("   ", "  ")).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
  });

  it("names the gap for em dash and legacy generic resident strings", () => {
    expect(formatLoadResidentsFullName("—", null)).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
    expect(formatLoadResidentsFullName("Unknown", null)).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
    expect(formatLoadResidentsFullName("Unknown", "resident")).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
    expect(formatLoadResidentsFullName("Unknown", "Resident")).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
    expect(formatLoadResidentsFullName("Unnamed", null)).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
    expect(formatLoadResidentsFullName("Unnamed", "resident")).toBe(LOAD_RESIDENTS_NO_NAME_COPY);
  });

  it("keeps a posted resident name", () => {
    expect(formatLoadResidentsFullName("Resident", "Alpha")).toBe("Resident Alpha");
    expect(formatLoadResidentsFullName("Resident", null)).toBe("Resident");
    expect(formatLoadResidentsFullName(null, "Beta")).toBe("Beta");
    expect(formatLoadResidentsFullName("  Resident  ", "  Gamma  ")).toBe("Resident Gamma");
  });

  it("never surfaces Unknown, Unknown resident, or a lone em dash", () => {
    expect(LOAD_RESIDENTS_NO_NAME_COPY).toBe("No name posted");
    expect(formatLoadResidentsFullName(null, null)).not.toBe("Unknown");
    expect(formatLoadResidentsFullName(null, null)).not.toBe("Unknown resident");
    expect(formatLoadResidentsFullName(null, null)).not.toBe("Unknown Resident");
    expect(formatLoadResidentsFullName(null, null)).not.toBe("—");
    expect(formatLoadResidentsFullName("Unknown", null)).not.toBe("Unknown");
    expect(formatLoadResidentsFullName("—", null)).not.toBe("—");
  });
});
