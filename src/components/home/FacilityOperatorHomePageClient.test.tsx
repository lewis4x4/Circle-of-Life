import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { HomeCensusOnTap } from "@/lib/home/census";
import type { HomeInitialData } from "@/lib/home/load-home";
import type { HomeOnTapPayload, HomeOnTapRow } from "@/lib/home/on-tap";

import { FacilityOperatorHomePageClient } from "./FacilityOperatorHomePageClient";

const rpc = vi.hoisted(() => vi.fn());
const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({ rpc }) }));
vi.mock("@/lib/executive/facility-rounding-compliance", () => ({
  fetchExecutiveFacilityCompliance: vi.fn().mockResolvedValue({ totals: { withTask: 50, onTime: 47 } }),
}));

const NY = "America/New_York";
const FACILITY = "00000000-0000-0000-0002-000000000003";

function row(overrides: Partial<HomeOnTapRow> & { id: string }): HomeOnTapRow {
  return {
    instanceId: overrides.id.replace(/^oti:/, ""),
    bucket: "assigned",
    title: `Task ${overrides.id}`,
    status: "pending",
    assignedShiftDate: "2026-09-22",
    owner: { kind: "queue" },
    href: `/admin/operations/work?facility_id=${FACILITY}`,
    ...overrides,
  };
}

function feed(overrides: Partial<HomeOnTapPayload> = {}): HomeOnTapPayload {
  return {
    facilityId: FACILITY,
    facilityName: "Sample Lodge",
    timezone: NY,
    asOf: "2026-09-22T13:12:00Z",
    localDate: "2026-09-22",
    isWeekend: false,
    endOfDayLocal: "17:00",
    escalatesTo: { userId: "exec", displayName: "Pat Example", title: "Facility Executive" },
    coOperators: [{ userId: "co", displayName: "Morgan Example", title: "Assistant Administrator" }],
    onDutyToday: [],
    counts: { regulatory: 1, assigned: 7, clearedToday: 1, later: 1 },
    rows: [],
    later: [],
    cleared: [],
    ...overrides,
  };
}

function initial(overrides: Partial<HomeInitialData> = {}): HomeInitialData {
  return {
    feed: feed(),
    snapshot: null,
    presence: { inHouse: 31, hospital: 2, onLeave: 2, onHold: 4, total: 35 },
    presenceAvailable: true,
    standUpCensus: { value: 35, weekStart: "2026-09-21" },
    rounding: { available: true, missedToday: 1, openEscalations: 0, lastEntryAt: "2026-09-22T13:04:00Z", lastEntryBy: "Taylor" },
    facilityOptions: [{ id: FACILITY, name: "Sample Lodge" }],
    census: null,
    releasedModules: [],
    pastDue: null,
    notesOnTap: [],
    ...overrides,
  };
}

const generator = row({
  id: "oti:gen",
  bucket: "regulatory",
  title: "Generator weekly run",
  catalogKey: "hfo-al-w01-01",
  dueAt: "2026-09-22T14:00:00Z",
  assetSchedule: { assetName: "Emergency generator", weekday: 2, localTime: "10:00:00", setAt: "2026-08-14T15:00:00Z" },
});

describe("FacilityOperatorHomePageClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: { success: true, assignedTo: "me", assignedAt: "2026-09-22T13:20:00Z" }, error: null });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, status: "completed" }) }));
  });

  it("greets by first name, caps the queue at seven, and keeps the rest under Later", () => {
    const rows = [generator, ...Array.from({ length: 7 }, (_, index) => row({ id: `oti:a${index}`, dueAt: `2026-09-22T1${index}:00:00Z` }))];
    const later = [row({ id: "oti:later", bucket: "regulatory", assignedShiftDate: "2026-09-25" })];
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ feed: feed({ rows, later, counts: { regulatory: 1, assigned: 7, clearedToday: 0, later: 1 } }) })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName="Charlene Example"
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello, Charlene.");
    expect(screen.getByText(/Morgan also covers this building/)).toBeInTheDocument();
    expect(screen.getByTestId("on-tap-count")).toHaveTextContent("8 on tap");
    const list = screen.getAllByRole("list")[0];
    expect(within(list).getAllByRole("listitem")).toHaveLength(7);
    expect(screen.getByTestId("later-summary")).toHaveTextContent("Later this week · 2");
    expect(screen.getByText("Generator weekly run — listen and confirm it ran")).toBeInTheDocument();
    expect(screen.queryByText(/Command center/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/triage/i)).not.toBeInTheDocument();
  });

  it("shows who claimed a row and clears the generator through the completion route in one tap, then refreshes from the server", async () => {
    const claimed = { ...generator, owner: { kind: "user" as const, userId: "co", displayName: "Morgan Example", claimedAt: "2026-09-22T12:41:00Z" } };
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ feed: feed({ rows: [claimed] }) })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName="Charlene Example"
      />,
    );
    expect(screen.getByText("Claimed by Morgan · 8:41 AM")).toBeInTheDocument();
    expect(screen.getByText("Schedule: Tue 10:00 AM · set 08/14")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "It ran" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [url, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/admin/operations/tasks/gen/complete");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(String(init.body))).toEqual({ outcome: "ran" });
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses Did not run without a note, then records the note", async () => {
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ feed: feed({ rows: [generator] }) })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName="Charlene Example"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Did not run" }));
    const record = screen.getByRole("button", { name: /Record “Did not run”/ });
    expect(record).toBeDisabled();
    expect(fetch).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText(/A note is required/), { target: { value: "No sound at 10:00." } });
    expect(record).toBeEnabled();
    fireEvent.click(record);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    const [, init] = vi.mocked(fetch).mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ outcome: "did_not_run", completion_notes: "No sound at 10:00." });
  });

  it("claims through the claim RPC and refreshes the feed", async () => {
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ feed: feed({ rows: [generator] }) })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName="Charlene Example"
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Claim" }));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith("home_claim_task", { p_instance_id: "gen", p_claim: true }));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
  });

  it("keeps Record payment dark until it is released for this facility, then opens it (COL-594)", async () => {
    const { unmount } = render(
      <FacilityOperatorHomePageClient initial={initial()} initialFacilityId={FACILITY} currentUserId="me" fullName={null} />,
    );
    expect(screen.getByRole("button", { name: /Record payment/ })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Record payment/ })).toHaveTextContent("Week 2");
    unmount();
    render(
      <FacilityOperatorHomePageClient initial={initial({ releasedModules: ["record_payment"] })} initialFacilityId={FACILITY} currentUserId="me" fullName={null} />,
    );
    const live = screen.getByTestId("quick-action-record_payment");
    expect(live).toBeEnabled();
    expect(live).not.toHaveTextContent("Week 2");
    expect(screen.getByRole("button", { name: /Quick note/ })).toBeDisabled();
    fireEvent.click(live);
    expect(await screen.findByRole("dialog", { name: "Record payment" })).toBeInTheDocument();
  });

  it("shows past-due rent only once released: count and total first, names after a tap, and a prefilled Record payment (COL-594)", async () => {
    const pastDue = {
      configured: true, localDate: "2026-09-22", graceDays: 5, defaultDueDay: 5,
      residents: [
        { residentId: "r-late", name: "Probe, Ada", oldestDueDate: "2026-08-05", daysPastDue: 48, openCents: 300000 },
        { residentId: "r-18", name: "Probe, Bea", oldestDueDate: "2026-09-18", daysPastDue: 4, openCents: 120000 },
      ],
    };
    const { unmount } = render(
      <FacilityOperatorHomePageClient initial={initial({ pastDue })} initialFacilityId={FACILITY} currentUserId="me" fullName={null} />,
    );
    expect(screen.queryByTestId("past-due-strip")).toBeNull();
    expect(screen.getByTestId("glance-rent")).toHaveTextContent("Week 2");
    unmount();

    render(
      <FacilityOperatorHomePageClient initial={initial({ pastDue, releasedModules: ["past_due", "record_payment"] })} initialFacilityId={FACILITY} currentUserId="me" fullName={null} />,
    );
    const strip = await screen.findByTestId("past-due-strip");
    expect(strip).toHaveTextContent("2 residents · $4,200.00 open");
    expect(within(strip).queryByText(/Probe, Ada/)).toBeNull();
    expect(screen.getByTestId("glance-rent")).toHaveTextContent("2");
    expect(screen.getByText("2 residents past due on rent")).toBeInTheDocument();
    fireEvent.click(within(strip).getByRole("button", { name: "Show names" }));
    expect(within(strip).getByText(/Probe, Ada/)).toBeInTheDocument();
    fireEvent.click(within(strip).getAllByRole("button", { name: "Record payment" })[0]);
    expect(await screen.findByRole("dialog", { name: "Record payment" })).toBeInTheDocument();
  });

  it("says rent terms are not set rather than showing nobody past due (COL-594)", async () => {
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ pastDue: { configured: false, localDate: "2026-09-22", residents: [] }, releasedModules: ["past_due"] })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName={null}
      />,
    );
    expect(await screen.findByTestId("past-due-unconfigured")).toHaveTextContent("not set for this building");
    expect(screen.queryByText(/past due on rent/)).toBeNull();
  });

  it("puts a released note task in On tap and opens Quick note (COL-595)", async () => {
    const notesOnTap = [{ noteId: "n-1", noteType: "maintenance", body: "Leak under sink in 12", followUpDate: "2026-09-22", overdue: false, assignee: { kind: "vendor" as const, vendorId: "v", displayName: "Probe Plumbing" }, residentId: null, updates: 0 }];
    const { unmount } = render(
      <FacilityOperatorHomePageClient initial={initial({ notesOnTap })} initialFacilityId={FACILITY} currentUserId="me" fullName={null} />,
    );
    expect(screen.queryByText("Leak under sink in 12")).toBeNull();
    expect(screen.getByRole("button", { name: /Quick note/ })).toBeDisabled();
    unmount();
    render(
      <FacilityOperatorHomePageClient initial={initial({ notesOnTap, releasedModules: ["quick_note"] })} initialFacilityId={FACILITY} currentUserId="me" fullName={null} />,
    );
    expect(screen.getAllByText("Leak under sink in 12").length).toBeGreaterThan(0);
    expect(await screen.findByTestId("notes-panel")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("quick-action-quick_note"));
    expect(await screen.findByRole("dialog", { name: "Quick note" })).toBeInTheDocument();
  });

  it("renders the weekend empty state with no queue rows", () => {
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ feed: feed({ isWeekend: true, rows: [], counts: { regulatory: 0, assigned: 0, clearedToday: 0, later: 0 } }) })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName={null}
      />,
    );
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Hello.");
    expect(screen.getByTestId("on-tap-empty")).toHaveTextContent("Nothing is on tap on Saturday or Sunday");
    expect(screen.getByTestId("on-tap-count")).toHaveTextContent("0 on tap");
  });

  it("shows presence counts as roster links and surfaces a Stand Up disagreement on the tile", () => {
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ presence: { inHouse: 29, hospital: 2, onLeave: 2, onHold: 4, total: 33 }, standUpCensus: { value: 35, weekStart: "2026-09-21" } })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName="Charlene Example"
      />,
    );
    expect(screen.getByTestId("presence-active")).toHaveTextContent("29");
    expect(screen.getByRole("link", { name: /Hospital: 2/ })).toHaveAttribute("href", "/admin/residents?status=hospital");
    expect(screen.getByRole("note")).toHaveTextContent("Weekly Stand Up reported 35 for the week of 2026-09-21; the roster shows 33.");
  });
  it("shows the quick links in the locked order with later weeks badged and disabled", () => {
    render(
      <FacilityOperatorHomePageClient initial={initial()} initialFacilityId={FACILITY} currentUserId="me" fullName="Charlene Example" />,
    );
    const strip = screen.getByLabelText("Quick actions");
    const labels = Array.from(strip.querySelectorAll("a, button")).map((node) => node.textContent?.replace(/Week \d/, "").trim());
    expect(labels).toEqual(["Open Stand Up", "Referrals", "My facility", "EMP", "Report incident", "Record payment", "Call-out", "Quick note"]);
    expect(within(strip).getByRole("link", { name: /My facility/ })).toHaveAttribute("href", `/admin/facilities/${FACILITY}`);
    expect(within(strip).getByRole("button", { name: /Record payment/ })).toBeDisabled();
    expect(within(strip).queryByText(/Maintenance ticket/)).not.toBeInTheDocument();
  });

  it("puts the monthly census on tap on the first business day and confirms it through the census RPC", async () => {
    const census: HomeCensusOnTap = {
      due: true,
      censusMonth: "2026-09-01",
      firstBusinessDay: "2026-10-01",
      status: "open",
      canRecord: true,
      snapshot: { daysInMonth: 30, daysLogged: 30, averageOccupied: 46.2, monthEndOccupied: 47, rosterCensus: 48 },
      confirmed: null,
      lastFlag: null,
    };
    render(
      <FacilityOperatorHomePageClient
        initial={initial({ feed: feed({ localDate: "2026-10-01", counts: { regulatory: 0, assigned: 0, clearedToday: 0, later: 0 } }), census })}
        initialFacilityId={FACILITY}
        currentUserId="me"
        fullName="Charlene Example"
      />,
    );
    expect(screen.getByText("Confirm census for September 2026")).toBeInTheDocument();
    expect(screen.getByText("Roster 48 · Month-end 47 · Avg 46.2 · 30/30 days logged")).toBeInTheDocument();
    expect(screen.getByText("Confirming notifies Pat Example")).toBeInTheDocument();
    expect(screen.getByTestId("on-tap-count")).toHaveTextContent("1 on tap");
    fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("home_record_census", { p_facility_id: FACILITY, p_census_month: "2026-09-01", p_outcome: "confirmed" }),
    );
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("asks for a note before recording Something wrong on the census", async () => {
    const census: HomeCensusOnTap = {
      due: true, censusMonth: "2026-09-01", firstBusinessDay: "2026-10-01", status: "open", canRecord: true,
      snapshot: null, confirmed: null, lastFlag: null,
    };
    render(
      <FacilityOperatorHomePageClient initial={initial({ census })} initialFacilityId={FACILITY} currentUserId="me" fullName={null} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Something wrong" }));
    const record = screen.getByRole("button", { name: /Record “Something wrong”/ });
    expect(record).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/A note is required/), { target: { value: "Two move-outs not yet entered." } });
    fireEvent.click(record);
    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith("home_record_census", {
        p_facility_id: FACILITY, p_census_month: "2026-09-01", p_outcome: "flagged", p_note: "Two move-outs not yet entered.",
      }),
    );
  });
});
