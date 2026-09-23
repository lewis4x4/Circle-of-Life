import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { LiveBoardCounts } from "@/lib/rounding/live-board-state";

import { LiveBoardSummary } from "./LiveBoardSummary";

const ZERO: LiveBoardCounts = {
  total: 0,
  critical: 0,
  overdue: 0,
  pending: 0,
  completed: 0,
  late: 0,
  onTime: 0,
  escalated: 0,
};

function renderSummary(loadState: "idle" | "loading" | "ready" | "error", counts: LiveBoardCounts = ZERO) {
  return render(
    <LiveBoardSummary counts={counts} rosterCount={0} loadState={loadState} filter="all" onFilterChange={vi.fn()} />,
  );
}

describe("LiveBoardSummary honest counts (COL-649)", () => {
  it("shows Unavailable, not 0, after the board failed to load", () => {
    renderSummary("error");
    expect(screen.getByRole("article", { name: "Critical: Unavailable" })).toBeInTheDocument();
    expect(screen.getByRole("article", { name: "Overdue: Unavailable" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Critical: 0" })).toBeNull();
  });

  it("shows Loading… while the board loads", () => {
    renderSummary("loading");
    expect(screen.getByRole("article", { name: "Residents on the roster: Loading…" })).toBeInTheDocument();
  });

  it("explains Overdue 0 beside a critical count", () => {
    renderSummary("ready", { ...ZERO, total: 298, critical: 298, escalated: 298 });
    expect(screen.getByRole("article", { name: "Overdue: 0" })).toBeInTheDocument();
    expect(screen.getByText(/298 went past it and are counted under Critical/)).toBeInTheDocument();
  });
});
