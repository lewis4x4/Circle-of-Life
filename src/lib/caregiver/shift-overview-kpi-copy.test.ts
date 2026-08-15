import { describe, expect, it } from "vitest";

import {
  caregiverShiftBoardIsEmpty,
  caregiverShiftOverviewEmptyNotice,
  caregiverShiftOverviewKpiStripHelperLine,
  caregiverShiftOverviewLoadErrorCopy,
  caregiverShiftOverviewLoadErrorRetryLabel,
  caregiverShiftOverviewLoadedLaneCount,
  caregiverShiftOverviewLoadingCopy,
  type CaregiverShiftOverviewMetrics,
} from "./shift-overview-kpi-copy";

function metrics(partial: Partial<CaregiverShiftOverviewMetrics>): CaregiverShiftOverviewMetrics {
  return {
    census: 0,
    urgentAlerts: 0,
    medicationsDue: 0,
    notesToFinish: 0,
    ...partial,
  };
}

describe("caregiverShiftBoardIsEmpty", () => {
  it("is true when every hero lane is zero", () => {
    expect(caregiverShiftBoardIsEmpty(metrics({}))).toBe(true);
  });

  it("is false when census is loaded with residents", () => {
    expect(caregiverShiftBoardIsEmpty(metrics({ census: 12 }))).toBe(false);
  });

  it("is false when only medications due is non-zero", () => {
    expect(caregiverShiftBoardIsEmpty(metrics({ medicationsDue: 3 }))).toBe(false);
  });
});

describe("caregiverShiftOverviewEmptyNotice", () => {
  it("names an empty shift without inventing tasks", () => {
    const notice = caregiverShiftOverviewEmptyNotice();
    expect(notice.title).toBe("No assigned work on this shift yet");
    expect(notice.helper).toContain("Ask a nurse or admin");
    expect(notice.helper).toContain("Rounds and meds stay empty until they are.");
  });
});

describe("caregiverShiftOverviewKpiStripHelperLine", () => {
  it("reuses the empty-shift helper when the whole board is empty", () => {
    expect(caregiverShiftOverviewKpiStripHelperLine(metrics({}))).toBe(
      caregiverShiftOverviewEmptyNotice().helper,
    );
  });

  it("explains real zeros when some lanes have work", () => {
    expect(caregiverShiftOverviewKpiStripHelperLine(metrics({ census: 12, medicationsDue: 0 }))).toBe(
      "Shift counts loaded — zeros mean nothing is due in that lane right now.",
    );
  });

  it("celebrates a fully loaded non-empty strip", () => {
    expect(
      caregiverShiftOverviewKpiStripHelperLine(
        metrics({ census: 12, urgentAlerts: 1, medicationsDue: 4, notesToFinish: 2 }),
      ),
    ).toBe("Shift overview loaded for this shift.");
  });
});

describe("caregiverShiftOverviewLoadedLaneCount", () => {
  it("returns zero lanes when the board is entirely empty", () => {
    expect(caregiverShiftOverviewLoadedLaneCount(metrics({}))).toBe(0);
  });

  it("returns all lanes once any work exists", () => {
    expect(caregiverShiftOverviewLoadedLaneCount(metrics({ census: 1 }))).toBe(4);
    expect(
      caregiverShiftOverviewLoadedLaneCount(metrics({ census: 12, medicationsDue: 0 })),
    ).toBe(4);
  });
});

describe("caregiverShiftOverviewLoadingCopy", () => {
  it("uses calm shift language", () => {
    expect(caregiverShiftOverviewLoadingCopy()).toBe("Loading this shift…");
    expect(caregiverShiftOverviewLoadingCopy()).not.toContain("Dashboard");
  });
});

describe("caregiverShiftOverviewLoadErrorCopy", () => {
  it("softens failure without connection jargon", () => {
    expect(caregiverShiftOverviewLoadErrorCopy()).toBe("Could not load this shift. Try again.");
    expect(caregiverShiftOverviewLoadErrorRetryLabel()).toBe("Try again");
  });
});
