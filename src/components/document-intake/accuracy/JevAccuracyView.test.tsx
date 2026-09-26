import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildAccuracyReport, type AccuracyReport, type JevOutcomeViewRow } from "@/lib/document-intake/jev-accuracy-report";

const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));

const loadAccuracyReport = vi.fn<(...args: unknown[]) => Promise<AccuracyReport>>();
vi.mock("./load", () => ({ loadAccuracyReport: (...args: unknown[]) => loadAccuracyReport(...args) }));
vi.mock("../data", () => ({
  intakeClient: () => ({}),
  IntakeReadError: class IntakeReadError extends Error {
    constructor(
      message: string,
      public forbidden: boolean,
    ) {
      super(message);
    }
  },
}));

import { JevAccuracyView } from "./JevAccuracyView";

const EM_DASH = String.fromCharCode(0x2014);

function outcome(i: number, over: Partial<JevOutcomeViewRow> = {}): JevOutcomeViewRow {
  return {
    filing_id: `f${i}`,
    item_id: `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    approved_at: `2026-09-${String(1 + (i % 20)).padStart(2, "0")}T15:00:00Z`,
    proposed_code: "vendor_coi",
    filed_code: "vendor_coi",
    type_correct: true,
    jev_state: "ran",
    questions_version: "intake-v2/vendor_coi.1",
    jev_choice: "c0",
    jev_margin: 0.25,
    margin_at_run: 0.2,
    jev_top_correct: true,
    ...over,
  };
}

function populated(): AccuracyReport {
  const outcomes = [
    ...Array.from({ length: 3 }, (_, i) => outcome(i, { jev_top_correct: false, jev_choice: "c1" })),
    ...Array.from({ length: 7 }, (_, i) => outcome(10 + i)),
    ...Array.from({ length: 25 }, (_, i) => outcome(20 + i, { jev_margin: 0.5 })),
  ];
  return buildAccuracyReport({ outcomes, checks: [], catalogLabels: { vendor_coi: "Vendor certificate of insurance" }, documentIntakeRouting: null });
}

beforeEach(() => {
  replace.mockReset();
  loadAccuracyReport.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("JevAccuracyView", () => {
  it("explains an empty window", async () => {
    loadAccuracyReport.mockResolvedValue({ readerAgreement: { agree: 0, total: 0 }, types: [], details: {}, misses: [] });
    render(<JevAccuracyView initialWindow="30" initialType={null} />);
    expect(await screen.findByText("No filed documents with Jev activity in this window yet")).toBeTruthy();
    expect(document.body.textContent).not.toContain(EM_DASH);
  });

  it("renders the three tiers and copies the setting change", async () => {
    loadAccuracyReport.mockResolvedValue(populated());
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<JevAccuracyView initialWindow="30" initialType={null} />);

    const tier1 = await screen.findByRole("table", { name: "Jev accuracy by document type" });
    expect(within(tier1).getByText("32 of 35")).toBeTruthy();
    expect(within(tier1).getByText("Tighten to 0.3")).toBeTruthy();
    expect(within(tier1).getByText("At last run")).toBeTruthy();
    expect(screen.getByText("35 of 35")).toBeTruthy();

    const typeButton = within(tier1).getByRole("button", { name: /Vendor certificate of insurance/ });
    expect(typeButton.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(typeButton);
    expect(typeButton.getAttribute("aria-expanded")).toBe("true");
    expect(replace).toHaveBeenLastCalledWith("/admin/document-intake/accuracy?type=vendor_coi", { scroll: false });
    expect(screen.getByRole("table", { name: "Margins for Vendor certificate of insurance" })).toBeTruthy();
    expect(screen.getByLabelText("Setting change statement").textContent).toContain("jsonb_build_object('vendor_coi', 0.3)");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Copy" }));
    });
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("update public.ai_invocation_policies"));
    expect(screen.getByRole("status").textContent).toBe("Copied.");

    const misses = screen.getByRole("table", { name: "Documents Jev missed" });
    expect(within(misses).getAllByRole("link")).toHaveLength(3);
    expect(within(misses).getAllByRole("link")[0].getAttribute("href")).toMatch(/^\/admin\/document-intake\/0{8}-/);
    expect(document.body.textContent).not.toContain(EM_DASH);
    expect(document.body.textContent?.toLowerCase()).not.toMatch(/\b(rows|query|fetch)\b/);
  });

  it("changes the window and reloads", async () => {
    loadAccuracyReport.mockResolvedValue(populated());
    render(<JevAccuracyView initialWindow="30" initialType={null} />);
    await screen.findByRole("table", { name: "Jev accuracy by document type" });
    fireEvent.click(screen.getByLabelText("90 days"));
    expect(replace).toHaveBeenLastCalledWith("/admin/document-intake/accuracy?window=90", { scroll: false });
    await screen.findByRole("table", { name: "Jev accuracy by document type" });
    expect(loadAccuracyReport).toHaveBeenLastCalledWith(expect.anything(), "90", expect.any(Number));
  });

  it("offers a retry when the read fails", async () => {
    loadAccuracyReport.mockRejectedValueOnce(new Error("boom")).mockResolvedValue(populated());
    render(<JevAccuracyView initialWindow="30" initialType={null} />);
    expect(await screen.findByText("Jev accuracy did not load")).toBeTruthy();
    expect(screen.queryByText("boom")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("table", { name: "Jev accuracy by document type" })).toBeTruthy();
  });
});
