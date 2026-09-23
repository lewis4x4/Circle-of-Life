import { describe, expect, it } from "vitest";

import {
  REPORT_RUN_INTERRUPTED_AFTER_MS,
  deriveReportRunState,
  deriveReportScheduleState,
  deriveTemplateScheduleLabel,
  isReportScheduleHealthy,
} from "./report-status";

const now = new Date("2026-09-22T18:00:00Z");
const validWeekly = '{"frequency":"weekly","weekday":1,"monthDay":1,"timeLocal":"08:00"}';

describe("deriveReportRunState", () => {
  it("keeps completed and failed as recorded", () => {
    expect(deriveReportRunState({ status: "completed", started_at: "2026-05-26T15:15:53Z" }, now).kind).toBe("completed");
    expect(deriveReportRunState({ status: "failed", started_at: "2026-05-26T15:15:53Z" }, now).kind).toBe("failed");
  });

  it("a run still running within the timeout is running", () => {
    const started = new Date(now.getTime() - REPORT_RUN_INTERRUPTED_AFTER_MS + 1000).toISOString();
    expect(deriveReportRunState({ status: "running", started_at: started }, now)).toMatchObject({ kind: "running", label: "Running" });
  });

  it("a run left running since May is interrupted, not running (production 2026-09-22)", () => {
    expect(deriveReportRunState({ status: "running", started_at: "2026-05-26T15:15:53Z" }, now)).toMatchObject({
      kind: "interrupted",
      tone: "danger",
    });
  });
});

describe("deriveReportScheduleState", () => {
  it("the two production pack schedules (bare 'weekly'/'quarterly', PDF, dates in the past) need setup, not Active", () => {
    for (const rule of ["weekly", "quarterly"]) {
      const state = deriveReportScheduleState(
        { status: "active", recurrence_rule: rule, output_format: "pdf", next_run_at: "2026-06-01T12:00:00Z" },
        now,
      );
      expect(state.kind).toBe("needs_setup");
      expect(state.label).not.toBe("Active");
      expect(state.recurrenceLabel).toMatch(/no day or time set/);
      expect(state.recurrenceLabel.toLowerCase()).not.toContain("needs review");
      expect(state.problem).toBeTruthy();
    }
  });

  it("names non-CSV output as the problem when timing is valid", () => {
    const state = deriveReportScheduleState(
      { status: "active", recurrence_rule: validWeekly, output_format: "pdf", next_run_at: "2026-09-28T12:00:00Z" },
      now,
    );
    expect(state.kind).toBe("needs_setup");
    expect(state.problem).toMatch(/PDF/);
    expect(state.outputLabel).toMatch(/not produced/);
  });

  it("an active schedule whose dispatch date passed more than a day ago is overdue", () => {
    const state = deriveReportScheduleState(
      { status: "active", recurrence_rule: validWeekly, output_format: "csv", next_run_at: "2026-08-26T12:00:00Z" },
      now,
    );
    expect(state).toMatchObject({ kind: "overdue", label: "Overdue", tone: "danger" });
    expect(isReportScheduleHealthy({ status: "active", recurrence_rule: validWeekly, output_format: "csv", next_run_at: "2026-08-26T12:00:00Z" }, now)).toBe(false);
  });

  it("an active schedule due in the future is Active with its real recurrence", () => {
    const state = deriveReportScheduleState(
      { status: "active", recurrence_rule: validWeekly, output_format: "csv", next_run_at: "2026-09-28T12:00:00Z" },
      now,
    );
    expect(state).toMatchObject({ kind: "active", label: "Active", recurrenceLabel: "Weekly · Monday · 08:00", problem: null });
  });

  it("failed schedules carry the runner's error", () => {
    const state = deriveReportScheduleState(
      { status: "failed", recurrence_rule: validWeekly, output_format: "csv", next_run_at: null, last_error: "Schedule owner no longer has report access." },
      now,
    );
    expect(state).toMatchObject({ kind: "failed", problem: "Schedule owner no longer has report access." });
  });
});

describe("deriveTemplateScheduleLabel", () => {
  const template = { id: "tpl-ar", slug: "ar-aging-summary" };
  const packItems = new Map([["pack-ceo", new Set(["tpl-ar"])]]);

  it("a template inside a stalled pack schedule needs attention instead of reading Not scheduled", () => {
    const schedules = [
      { source_type: "pack", source_id: "pack-ceo", status: "active", recurrence_rule: "weekly", output_format: "pdf", next_run_at: "2026-06-01T12:00:00Z" },
    ];
    expect(deriveTemplateScheduleLabel(template, schedules, packItems, now)).toBe("Schedule needs attention");
  });

  it("a healthy pack or template schedule reads Scheduled; none reads Not scheduled", () => {
    const healthy = { status: "active", recurrence_rule: validWeekly, output_format: "csv", next_run_at: "2026-09-28T12:00:00Z" };
    expect(deriveTemplateScheduleLabel(template, [{ ...healthy, source_type: "pack", source_id: "pack-ceo" }], packItems, now)).toBe("Scheduled");
    expect(deriveTemplateScheduleLabel(template, [{ ...healthy, source_type: "template", source_id: "tpl-ar" }], new Map(), now)).toBe("Scheduled");
    expect(deriveTemplateScheduleLabel(template, [], packItems, now)).toBe("Not scheduled");
  });
});

describe("one status function (COL-643)", () => {
  it("no report surface re-derives the interrupt timeout on its own", async () => {
    const { readFileSync } = await import("node:fs");
    for (const file of [
      "src/app/(admin)/reports/history/[id]/page.tsx",
      "src/app/(admin)/reports/history/page.tsx",
      "src/app/(admin)/reports/page.tsx",
      "src/app/api/reports/scheduler/route.ts",
    ]) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(/30\s*\*\s*60\s*\*\s*1000/);
    }
  });
});
