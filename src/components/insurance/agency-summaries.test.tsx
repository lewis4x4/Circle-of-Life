import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  act,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import AgencySummariesPage from "./agency-summaries";
import { agencySummaryFixture } from "./test-support/agency-summary-fixture";
const auth = vi.hoisted(() => ({
  loading: false,
  organizationId: "org",
  appRole: "owner",
  user: { id: "actor" },
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/insurance/agency-summaries",
}));
beforeEach(() => {
  auth.loading = false;
  auth.organizationId = "org";
  auth.appRole = "owner";
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json(agencySummaryFixture())),
  );
});
describe("read-only source-stated agency summaries", () => {
  it("waits for profile authority and never fetches for facility readers", () => {
    auth.loading = true;
    const view = render(<AgencySummariesPage />);
    expect(screen.getByRole("status")).toHaveTextContent(
      "Loading insurance profile",
    );
    expect(fetch).not.toHaveBeenCalled();
    auth.loading = false;
    auth.appRole = "facility_admin";
    view.rerender(<AgencySummariesPage />);
    expect(
      screen.getByText(/Agency summaries are restricted/),
    ).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalled();
  });
  it("provides a truthful disabled empty state without pretending there is no insurance", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ ...agencySummaryFixture(), connections: [] }),
    );
    render(<AgencySummariesPage />);
    expect(
      await screen.findByRole("heading", { name: "Live connection disabled" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/does not mean the organization has no insurance/),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /enable|connect|import|export|edit/i,
      }),
    ).not.toBeInTheDocument();
  });
  it("shows raw numeric premium and source wording without converting to money or verified coverage", async () => {
    render(<AgencySummariesPage />);
    await screen.findByRole("heading", { name: "IF-SYN-42" });
    expect(screen.getByText("90000.75")).toBeInTheDocument();
    expect(
      screen.getByText(/currency, units and period basis are unconfirmed/),
    ).toBeInTheDocument();
    expect(screen.getByText("source descriptive status")).toBeInTheDocument();
    expect(screen.getByText("9007199254740993")).toBeInTheDocument();
    expect(screen.queryByText("$90,000.75")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /edit|export|approve|convert/i }),
    ).not.toBeInTheDocument();
  });
  it("keeps incomplete body status separate from a current authorization check", async () => {
    const data = agencySummaryFixture();
    data.connections[0].state = "degraded";
    data.connections[0].incomplete_summary_count = 2;
    vi.mocked(fetch).mockResolvedValue(Response.json(data));
    render(<AgencySummariesPage />);
    await screen.findByRole("heading", { name: "IF-SYN-42" });
    expect(
      screen.getByText(/Degraded — some summaries unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/2 source summaries unavailable/),
    ).toBeInTheDocument();
    expect(screen.getByText("Last authorization check")).toBeInTheDocument();
  });
  it("removes visible fields when authorization freshness expires", async () => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json(agencySummaryFixture(500)),
    );
    render(<AgencySummariesPage />);
    await screen.findByRole("heading", { name: "IF-SYN-42" });
    await waitFor(
      () =>
        expect(
          screen.queryByRole("heading", { name: "IF-SYN-42" }),
        ).not.toBeInTheDocument(),
      { timeout: 2000 },
    );
    expect(
      screen.getByText(/Authorization unavailable or expired/),
    ).toBeInTheDocument();
  });
  it("clears prior summaries immediately on refresh failure and does not reflect raw error bodies", async () => {
    render(<AgencySummariesPage />);
    await screen.findByRole("heading", { name: "IF-SYN-42" });
    vi.mocked(fetch).mockResolvedValue(
      new Response("PRIVATE-OFFENDING-BODY", { status: 503 }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh agency summaries" }),
    );
    expect(
      screen.queryByRole("heading", { name: "IF-SYN-42" }),
    ).not.toBeInTheDocument();
    await screen.findByRole("alert");
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  });
  it("hides source data while offline instead of offering cached values", async () => {
    render(<AgencySummariesPage />);
    await screen.findByRole("heading", { name: "IF-SYN-42" });
    fireEvent(window, new Event("offline"));
    expect(screen.getByText(/unavailable while offline/)).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "IF-SYN-42" }),
    ).not.toBeInTheDocument();
  });
  it("ignores a late response after the reader role changes", async () => {
    let complete: (response: Response) => void = () => {};
    vi.mocked(fetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const view = render(<AgencySummariesPage />);
    auth.appRole = "facility_admin";
    view.rerender(<AgencySummariesPage />);
    await act(async () => {
      complete(Response.json(agencySummaryFixture()));
    });
    expect(
      screen.queryByRole("heading", { name: "IF-SYN-42" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByText(/Agency summaries are restricted/),
    ).toBeInTheDocument();
  });
  it("does not show unknown fields or stale summaries from disabled projections", async () => {
    const data = agencySummaryFixture();
    data.connections[0].enabled = false;
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ ...data, raw_quarantine: "PRIVATE-BODY" }),
    );
    render(<AgencySummariesPage />);
    await screen.findByRole("heading", { name: "Synthetic agency connection" });
    expect(
      screen.queryByRole("heading", { name: "IF-SYN-42" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  });
  it("does not leak unexpected JSON parsing fragments", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("PRIVATE-NON-JSON"));
    render(<AgencySummariesPage />);
    await screen.findByRole("alert");
    expect(screen.queryByText(/PRIVATE/)).not.toBeInTheDocument();
  });
});

it("requires a fresh read when authority returns instead of reviving prior component state", async () => {
  const view = render(<AgencySummariesPage />);
  await screen.findByRole("heading", { name: "IF-SYN-42" });
  auth.appRole = "facility_admin";
  view.rerender(<AgencySummariesPage />);
  expect(
    screen.queryByRole("heading", { name: "IF-SYN-42" }),
  ).not.toBeInTheDocument();
  vi.mocked(fetch).mockImplementation(() => new Promise(() => {}));
  auth.appRole = "owner";
  view.rerender(<AgencySummariesPage />);
  expect(screen.getByRole("status")).toHaveTextContent(
    "Checking authorized agency summaries",
  );
  expect(
    screen.queryByRole("heading", { name: "IF-SYN-42" }),
  ).not.toBeInTheDocument();
});
