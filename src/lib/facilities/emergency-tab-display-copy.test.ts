import { describe, expect, it } from "vitest";

import {
  EMERGENCY_TAB_NO_HOURS_COPY,
  EMERGENCY_TAB_NO_PHONE_COPY,
  EMERGENCY_TAB_NO_VERIFY_DATE_COPY,
  formatEmergencyTabHoursLine,
  formatEmergencyTabPhone,
  formatEmergencyTabVerifyLine,
} from "./emergency-tab-display-copy";

const EM_DASH = "—";

describe("formatEmergencyTabVerifyLine", () => {
  it("names a missing verify date instead of Last verified —", () => {
    expect(formatEmergencyTabVerifyLine(null)).toBe(EMERGENCY_TAB_NO_VERIFY_DATE_COPY);
    expect(formatEmergencyTabVerifyLine(undefined)).toBe(EMERGENCY_TAB_NO_VERIFY_DATE_COPY);
    expect(formatEmergencyTabVerifyLine("")).toBe(EMERGENCY_TAB_NO_VERIFY_DATE_COPY);
    expect(formatEmergencyTabVerifyLine("   ")).toBe(EMERGENCY_TAB_NO_VERIFY_DATE_COPY);
    expect(formatEmergencyTabVerifyLine(EM_DASH)).toBe(EMERGENCY_TAB_NO_VERIFY_DATE_COPY);
    expect(formatEmergencyTabVerifyLine(`  ${EM_DASH}  `)).toBe(EMERGENCY_TAB_NO_VERIFY_DATE_COPY);
    expect(formatEmergencyTabVerifyLine(null)).not.toContain("Last verified");
    expect(formatEmergencyTabVerifyLine(null)).not.toBe(EM_DASH);
  });

  it("returns Last verified with a posted ISO date formatted", () => {
    expect(formatEmergencyTabVerifyLine("2026-01-15")).toMatch(/^Last verified /);
    expect(formatEmergencyTabVerifyLine("2026-01-15")).toContain("Jan");
    expect(formatEmergencyTabVerifyLine("2026-01-15")).toContain("2026");
  });

  it("returns Last verified with a posted display string", () => {
    expect(formatEmergencyTabVerifyLine("Mar 1, 2026")).toBe("Last verified Mar 1, 2026");
  });
});

describe("formatEmergencyTabPhone", () => {
  it("names a missing phone instead of an em dash", () => {
    expect(formatEmergencyTabPhone(null)).toBe(EMERGENCY_TAB_NO_PHONE_COPY);
    expect(formatEmergencyTabPhone(undefined)).toBe(EMERGENCY_TAB_NO_PHONE_COPY);
    expect(formatEmergencyTabPhone("")).toBe(EMERGENCY_TAB_NO_PHONE_COPY);
    expect(formatEmergencyTabPhone("   ")).toBe(EMERGENCY_TAB_NO_PHONE_COPY);
    expect(formatEmergencyTabPhone(EM_DASH)).toBe(EMERGENCY_TAB_NO_PHONE_COPY);
    expect(formatEmergencyTabPhone(`  ${EM_DASH}  `)).toBe(EMERGENCY_TAB_NO_PHONE_COPY);
    expect(formatEmergencyTabPhone(null)).not.toBe(EM_DASH);
  });

  it("returns a posted phone trimmed", () => {
    expect(formatEmergencyTabPhone("  352-555-0100  ")).toBe("352-555-0100");
  });
});

describe("formatEmergencyTabHoursLine", () => {
  it("names missing hours instead of Hours: —", () => {
    expect(formatEmergencyTabHoursLine(null)).toBe(EMERGENCY_TAB_NO_HOURS_COPY);
    expect(formatEmergencyTabHoursLine(undefined)).toBe(EMERGENCY_TAB_NO_HOURS_COPY);
    expect(formatEmergencyTabHoursLine("")).toBe(EMERGENCY_TAB_NO_HOURS_COPY);
    expect(formatEmergencyTabHoursLine("   ")).toBe(EMERGENCY_TAB_NO_HOURS_COPY);
    expect(formatEmergencyTabHoursLine(EM_DASH)).toBe(EMERGENCY_TAB_NO_HOURS_COPY);
    expect(formatEmergencyTabHoursLine(`  ${EM_DASH}  `)).toBe(EMERGENCY_TAB_NO_HOURS_COPY);
    expect(formatEmergencyTabHoursLine(null)).not.toBe(`Hours: ${EM_DASH}`);
    expect(formatEmergencyTabHoursLine(null)).not.toContain(EM_DASH);
  });

  it("returns Hours: with a posted hours string", () => {
    expect(formatEmergencyTabHoursLine("Mon–Fri 8am–5pm")).toBe("Hours: Mon–Fri 8am–5pm");
    expect(formatEmergencyTabHoursLine("  24/7  ")).toBe("Hours: 24/7");
  });
});
