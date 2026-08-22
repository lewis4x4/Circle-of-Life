import { describe, expect, it } from "vitest";

import {
  countOverdueAssessments,
  getComplianceDashboardDateWindow,
} from "@/lib/compliance-dashboard-snapshot";

describe("getComplianceDashboardDateWindow (Eastern wall clock)", () => {
  /** 8:05 PM Eastern on 2026-08-24 (EDT, UTC−4) — UTC calendar day is already tomorrow. */
  const eightOhFivePmEtAug24 = new Date("2026-08-24T20:05:00-04:00");

  it("keeps today on the Eastern calendar after 8pm ET, not UTC ISO slice", () => {
    const window = getComplianceDashboardDateWindow(eightOhFivePmEtAug24);

    expect(window.today).toBe("2026-08-24");
    expect(window.today).not.toBe("2026-08-25");
    expect(eightOhFivePmEtAug24.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("offsets +30 on the Eastern calendar after 8pm ET", () => {
    const window = getComplianceDashboardDateWindow(eightOhFivePmEtAug24);

    expect(window.plus30).toBe("2026-09-23");
  });
});

describe("countOverdueAssessments (Eastern date-only cutoff)", () => {
  /** 8:05 PM Eastern on 2026-08-24 — assessment due on the Eastern today is not overdue. */
  const eightOhFivePmEtAug24 = new Date("2026-08-24T20:05:00-04:00");
  const easternToday = "2026-08-24";

  const rows = [
    {
      resident_id: "r-001",
      assessment_type: "annual",
      assessment_date: "2025-08-01",
      next_due_date: "2026-08-24",
    },
    {
      resident_id: "r-002",
      assessment_type: "annual",
      assessment_date: "2025-08-01",
      next_due_date: "2026-08-23",
    },
  ];

  it("does not mark assessments due on Eastern today as overdue after 8pm ET", () => {
    expect(countOverdueAssessments(rows, easternToday)).toBe(1);
  });

  it("would mis-count if UTC tomorrow were used as the overdue cutoff", () => {
    const utcTomorrow = eightOhFivePmEtAug24.toISOString().slice(0, 10);
    expect(utcTomorrow).toBe("2026-08-25");
    expect(countOverdueAssessments(rows, utcTomorrow)).toBe(2);
  });

  it("keeps real zero when nothing is past the Eastern cutoff", () => {
    const currentOnly = [
      {
        resident_id: "r-003",
        assessment_type: "annual",
        assessment_date: "2025-08-01",
        next_due_date: "2026-08-24",
      },
    ];
    expect(countOverdueAssessments(currentOnly, easternToday)).toBe(0);
  });
});
