import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const pageSource = readFileSync(`${import.meta.dirname}/page.tsx`, "utf8");

describe("emergency preparedness facility dates", () => {
  it("defaults the drill date to the Eastern facility calendar and stamps the field", () => {
    expect(pageSource).toContain("drill_date: todayFacilityDateIso()");
    expect(pageSource).toContain('label="Drill date (ET)"');
    expect(pageSource).not.toContain("drill_date: new Date().toISOString().slice(0, 10)");
  });

  it("saves a drill as a draft and says so, rather than implying a satisfied requirement", () => {
    // COL-242: the page keeps writing drafts, so it must state that and point at the step that completes them.
    expect(pageSource).toContain("setDrillNotice(DRILL_LOG_DRAFT_SAVED_COPY)");
    expect(pageSource).toContain("Log drill as a draft");
    expect(pageSource).toContain("/admin/operations/work");
    expect(pageSource).toContain("formatDrillRecordState(entry)");
    expect(pageSource).toContain("finalized_at, voided_at");
    expect(pageSource).toContain("formatDrillSaveProblem(");
  });

  it("still records only drafts here: no finality is written from this page", () => {
    // The row type reads finality; the insert type must never carry it, and the commands stay on the work surface.
    const insertType = pageSource.slice(pageSource.indexOf("type DrillLogInsert = {"), pageSource.indexOf("type MaintenanceTicketRow"));
    expect(insertType).toContain("drill_type: DrillType;");
    for (const column of ["finalized_at", "finalized_by", "voided_at", "void_reason", "record_version", "entry_reason", "correction_reason"]) {
      expect(insertType).not.toContain(column);
    }
    for (const command of ["finalize_drill_log_review", "correct_drill_log_review", "void_drill_log_review"]) {
      expect(pageSource).not.toContain(command);
    }
  });

  it("calculates checklist next-due dates on the facility calendar", () => {
    expect(pageSource).toContain(
      "complete_emergency_checklist_review",
    );
    expect(pageSource).toContain(
      "addFacilityCalendarDays(todayFacilityDateIso(), newItemDialog.frequency)",
    );
    expect(pageSource).not.toContain('next_due_date: nextDueDate.toISOString().split("T")[0]');
  });
});
