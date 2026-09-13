import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import axe from "axe-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page from "./page";

const env = vi.hoisted(() => ({
  query: "facility_id=facility&activity_id=activity",
  actor: "person",
  role: "owner",
  replace: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: env.replace }),
  useSearchParams: () => new URLSearchParams(env.query),
  usePathname: () => "/admin/operations/history",
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: { id: env.actor },
    fullName: "Dana",
    appRole: env.role,
    loading: false,
  }),
}));
vi.mock("@/lib/admin-facilities", () => ({
  fetchAdminFacilityOptions: async () => [
    { id: "facility", name: "Homewood" },
    { id: "other", name: "Other facility" },
  ],
}));
vi.mock("../work/_components/receipt-history", () => ({
  localTime: (value: string) => value,
  ReceiptSummary: () => <p>Recorded by Dana</p>,
  ReceiptHistory: () => <p>Full receipt chain</p>,
}));
function reply(extra = {}) {
  return {
    facility_id: "facility",
    facility_name: "Homewood",
    facility_timezone: "America/New_York",
    activities: [{ id: "activity", name: "Generator check" }],
    activity_id: "activity",
    history: [
      {
        id: "occurrence",
        activity_name: "Generator check",
        due_at: null,
        created_at: "2026-09-12T12:00:00Z",
        status: "completed",
        execution_state: "performed",
        receipt: null,
      },
    ],
    next_cursor: "page-two",
    total: 1101,
    open_issues: 2,
    next_due_at: null,
    schedule_status: "unknown",
    last_receipt: null,
    partial: [],
    ...extra,
  };
}
const ok = (body = reply()) => ({ ok: true, json: async () => body });
beforeEach(() => {
  env.query = "facility_id=facility&activity_id=activity";
  env.actor = "person";
  env.role = "owner";
  env.replace.mockClear();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(ok()));
});

describe("Corporate activity history", () => {
  it("shows independent totals and unknown schedules, pages opaque cursors and loads receipts on demand", async () => {
    render(<Page />);
    await screen.findByText("Total occurrences: 1101");
    expect(screen.getByText("Open issues: 2")).toBeInTheDocument();
    expect(screen.getByText("Next due: Unknown — no next due date available")).toBeInTheDocument();
    expect(screen.queryByText("Full receipt chain")).not.toBeInTheDocument();
    const details = screen.getByText(
      "Receipts, corrections, evidence and issues",
    ).parentElement as HTMLDetailsElement;
    details.open = true;
    fireEvent(details, new Event("toggle"));
    await screen.findByText("Full receipt chain");
    fireEvent.click(screen.getByRole("button", { name: "Older history" }));
    expect(env.replace).toHaveBeenCalledWith(
      "/admin/operations/history?facility_id=facility&activity_id=activity&cursor=page-two",
      { scroll: false },
    );
  });
  it("clears activity and cursor when the facility changes", async () => {
    env.query += "&cursor=old";
    render(<Page />);
    fireEvent.change(await screen.findByLabelText("Facility"), {
      target: { value: "other" },
    });
    expect(env.replace).toHaveBeenCalledWith(
      "/admin/operations/history?facility_id=other",
      { scroll: false },
    );
  });
  it("does not display a stale response after a facility switch", async () => {
    let resolveOld!: (value: ReturnType<typeof ok>) => void;
    vi.mocked(fetch)
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve as unknown as typeof resolveOld;
          }),
      )
      .mockResolvedValueOnce(
        ok(reply({ facility_name: "Other facility", history: [] })) as Response,
      );
    const view = render(<Page />);
    env.query = "facility_id=other&activity_id=activity";
    view.rerender(<Page />);
    await screen.findByText("Generator check at Other facility");
    resolveOld(ok());
    await waitFor(() =>
      expect(
        screen.queryByText("Generator check at Homewood"),
      ).not.toBeInTheDocument(),
    );
  });
  it("hides prior actor data immediately on access revocation", async () => {
    const view = render(<Page />);
    await screen.findByText("Total occurrences: 1101");
    env.role = "resident";
    view.rerender(<Page />);
    expect(
      screen.queryByText("Total occurrences: 1101"),
    ).not.toBeInTheDocument();
    expect(env.replace).toHaveBeenCalledWith("/dashboard");
  });
  it("distinguishes failed reads from empty history and retries", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce({ ok: false, status: 503 } as Response)
      .mockResolvedValueOnce(
        ok(reply({ history: [], total: 0, next_cursor: null })) as Response,
      );
    render(<Page />);
    await screen.findByRole("alert");
    expect(
      screen.queryByText("No occurrence history recorded for this activity."),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry history" }));
    await screen.findByText(
      "No occurrence history recorded for this activity.",
    );
  });
  it("does not claim no performance when the independent latest receipt read fails", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok(reply({ partial: ["last_receipt"] })) as Response,
    );
    render(<Page />);
    await screen.findByText("Completion details unavailable.");
    expect(
      screen.queryByText("No performance recorded."),
    ).not.toBeInTheDocument();
  });
  it("keeps partial counts unavailable and has no accessibility violations", async () => {
    vi.mocked(fetch).mockResolvedValue(
      ok(
        reply({ partial: ["issues", "schedule"], open_issues: null }),
      ) as Response,
    );
    const { container } = render(<Page />);
    await screen.findByText("Open issues: Unavailable");
    expect(
      screen.getByText("Next due: Schedule unavailable"),
    ).toBeInTheDocument();
    expect((await axe.run(container)).violations).toEqual([]);
  });
});
