import { describe, expect, it } from "vitest";

import {
  EXECUTIVE_LIVE_MISSED_RATE_NOT_COMPUTED_COPY,
  formatExecutiveLiveMissedRate,
  getExecutiveKpiDateWindow,
  summarizeExecutiveFinancial,
} from "@/lib/exec-kpi-snapshot";

describe("getExecutiveKpiDateWindow (Eastern wall clock)", () => {
  /** 8:05 PM Eastern on 2026-08-24 (EDT, UTC−4) — UTC calendar day is already tomorrow. */
  const eightOhFivePmEtAug24 = new Date("2026-08-24T20:05:00-04:00");

  it("keeps today on the Eastern calendar after 8pm ET, not UTC ISO slice", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtAug24);

    expect(window.today).toBe("2026-08-24");
    expect(window.today).not.toBe("2026-08-25");
    expect(eightOhFivePmEtAug24.toISOString().slice(0, 10)).toBe("2026-08-25");
  });

  it("offsets +30 on the Eastern calendar after 8pm ET", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtAug24);

    expect(window.plus30).toBe("2026-09-23");
  });

  it("anchors MTD start to Eastern month, not UTC month", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtAug24);

    expect(window.mtdStart).toBe("2026-08-01");
  });

  /** 8:05 PM Eastern on 2026-01-31 (EST) — UTC month is February. */
  const eightOhFivePmEtJan31 = new Date("2026-01-31T20:05:00-05:00");

  it("uses Eastern start-of-month when UTC has rolled to the next month", () => {
    const window = getExecutiveKpiDateWindow(eightOhFivePmEtJan31);

    expect(window.today).toBe("2026-01-31");
    expect(window.mtdStart).toBe("2026-01-01");
    expect(window.mtdStart).not.toBe("2026-02-01");
  });
});

describe("formatExecutiveLiveMissedRate", () => {
  it("names the live-load gap instead of showing a fabricated zero", () => {
    expect(formatExecutiveLiveMissedRate(null)).toBe(EXECUTIVE_LIVE_MISSED_RATE_NOT_COMPUTED_COPY);
    expect(formatExecutiveLiveMissedRate(0)).toBe("0%");
    expect(formatExecutiveLiveMissedRate(0.125)).toBe("13%");
  });
});

describe("summarizeExecutiveFinancial (COL-667)", () => {
  const row = (status: string, balance: number, due = "2026-05-15") => ({ facility_id: "hw", status, balance_due: balance, due_date: due });

  it("reproduces Homewood: AR is the $16,968.00 Billing shows, drafts counted apart", () => {
    const rows = [
      ...Array.from({ length: 10 }, () => row("overdue", 169_680)),
      ...Array.from({ length: 28 }, () => row("draft", 201_979, "2026-08-05")),
      ...Array.from({ length: 29 }, () => row("draft", 208_807, "2026-09-05")),
    ];
    expect(summarizeExecutiveFinancial(rows, "2026-09-22")).toEqual({
      openInvoicesCount: 10,
      totalBalanceDueCents: 1_696_800,
      notYetSentCount: 57,
      notYetSentCents: 28 * 201_979 + 29 * 208_807,
    });
  });

  it("never counts a draft, a paid or a void invoice as AR", () => {
    const financial = summarizeExecutiveFinancial([row("draft", 100), row("paid", 100), row("void", 100)], "2026-09-22");
    expect(financial.openInvoicesCount).toBe(0);
    expect(financial.totalBalanceDueCents).toBe(0);
    expect(financial.notYetSentCount).toBe(1);
  });
});
