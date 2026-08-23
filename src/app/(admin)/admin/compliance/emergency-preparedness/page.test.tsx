import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(`${import.meta.dirname}/page.tsx`, "utf8");

describe("emergency preparedness facility dates", () => {
  it("defaults the drill date to the Eastern facility calendar and stamps the field", () => {
    expect(pageSource).toContain("drill_date: todayFacilityDateIso()");
    expect(pageSource).toContain('label="Drill date (ET)"');
    expect(pageSource).not.toContain("drill_date: new Date().toISOString().slice(0, 10)");
  });

  it("calculates checklist next-due dates on the facility calendar", () => {
    expect(pageSource).toContain(
      "addFacilityCalendarDays(todayFacilityDateIso(), item.frequency_days)",
    );
    expect(pageSource).toContain(
      "addFacilityCalendarDays(todayFacilityDateIso(), newItemDialog.frequency)",
    );
    expect(pageSource).not.toContain('next_due_date: nextDueDate.toISOString().split("T")[0]');
  });
});
