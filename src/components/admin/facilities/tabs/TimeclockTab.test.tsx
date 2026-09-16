import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { TimeclockTab } from "./TimeclockTab";

const FACILITY = "00000000-0000-0000-0002-000000000003";

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const device = { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", label: "Front desk", enrolled_at: "2026-09-16T12:00:00.000Z", last_seen_at: null, revoked_at: null, throttled_until: null };

describe("TimeclockTab", () => {
  it("shows the flag, lists tablets, and lets an org admin enroll and revoke", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { enabled: false, devices: [device], can_manage: true }))
      .mockResolvedValueOnce(json(200, { ok: true, enabled: true }))
      .mockResolvedValueOnce(json(200, { code: "ABCD2345", expires_at: "2026-09-16T12:15:00.000Z" }))
      .mockResolvedValueOnce(json(200, { ok: true }))
      .mockResolvedValueOnce(json(200, { enabled: true, devices: [{ ...device, revoked_at: "2026-09-16T12:20:00.000Z" }], can_manage: true }));
    render(<TimeclockTab facilityId={FACILITY} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(await screen.findByTestId("timeclock-flag")).toHaveTextContent("Off for this facility");
    expect(screen.getByText("Front desk")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Turn timeclock on" }));
    await waitFor(() => expect(screen.getByTestId("timeclock-flag")).toHaveTextContent("On for this facility"));
    const flagBody = JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body));
    expect(flagBody).toEqual({ facility_id: FACILITY, action: "set_enabled", enabled: true });

    fireEvent.click(screen.getByRole("button", { name: "Enroll a tablet" }));
    expect(await screen.findByTestId("enrollment-code")).toHaveTextContent("ABCD2345");

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await waitFor(() => expect(screen.getByText("No tablets enrolled.")).toBeInTheDocument());
    expect(screen.getByText("1 revoked tablet kept for history.")).toBeInTheDocument();
  });

  it("is read-only for a facility administrator", async () => {
    const fetchImpl = vi.fn(async () => json(200, { enabled: true, devices: [device], can_manage: false }));
    render(<TimeclockTab facilityId={FACILITY} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(await screen.findByTestId("timeclock-flag")).toHaveTextContent("On for this facility");
    expect(screen.queryByRole("button", { name: /Turn timeclock/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Enroll a tablet" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Revoke" })).toBeNull();
  });
});
