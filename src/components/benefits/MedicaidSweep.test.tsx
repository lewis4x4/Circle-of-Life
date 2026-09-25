import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MedicaidSweepHomeCard, MedicaidSweepPanel, sweepProgress } from "./MedicaidSweep";

const facilityId = "11111111-1111-4111-8111-111111111111";
const facility = { facility_id: facilityId, facility_name: "Anon Facility", started_at: null, started_by_name: null, can_write: true, total: 3, answered: 0, remaining: null };
const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status }));
afterEach(() => vi.unstubAllGlobals());

describe("Medicaid current-resident sweep", () => {
  it("states progress in plain words", () => {
    expect(sweepProgress({ total: 48, answered: 12 })).toBe("12 of 48 current residents answered");
  });
  it("owners start it only after confirming, once per facility", async () => {
    let started = false;
    const fetch = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") { started = true; return json({ sweep_id: facilityId, facility_id: facilityId, started_at: "2026-09-24T18:00:00Z", already_started: false }, 201); }
      return json({ can_start: true, facilities: [started ? { ...facility, started_at: "2026-09-24T18:00:00Z", started_by_name: "Brian Lewis" } : facility] });
    });
    vi.stubGlobal("fetch", fetch);
    render(<MedicaidSweepPanel />);
    expect(await screen.findByText("Not started")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start current-resident sweep" }));
    expect(screen.getByText(/all 3 current residents at Anon Facility/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start the sweep" }));
    expect(await screen.findByText("3 still to ask")).toBeTruthy();
    expect(JSON.parse(fetch.mock.calls.find(([, init]) => init?.method === "POST")![1].body as string)).toMatchObject({ facility_id: facilityId });
  });
  it("administrators cannot start it and see who still needs asking", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ can_start: false, facilities: [{ ...facility, started_at: "2026-09-24T18:00:00Z", answered: 1, remaining: [{ resident_id: facilityId, resident_name: "Anon Resident", status: "loa" }] }] })));
    render(<MedicaidSweepPanel facilityId={facilityId} />);
    expect(await screen.findByText("Anon Resident")).toBeTruthy();
    expect(screen.getByText("(leave of absence)")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Start current-resident sweep" })).toBeNull();
  });
  it("home card appears only while a started sweep is incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ can_start: false, facilities: [facility] })));
    const notStarted = render(<MedicaidSweepHomeCard facilityId={facilityId} />);
    await waitFor(() => expect(notStarted.container.textContent).toBe(""));
    notStarted.unmount();
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ can_start: false, facilities: [{ ...facility, started_at: "2026-09-24T18:00:00Z", answered: 1 }] })));
    render(<MedicaidSweepHomeCard facilityId={facilityId} />);
    expect(await screen.findByText("2 still to ask")).toBeTruthy();
  });
  it("an unexpected reply is an error, not 'complete'", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => json({ nope: true })));
    render(<MedicaidSweepPanel />);
    expect(await screen.findByText(/could not be verified/)).toBeTruthy();
  });
});
