import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
    expect(screen.getByTestId("enrollment-instruction")).toHaveTextContent("/kiosk/setup");
    const enrollBody = JSON.parse(String((fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body));
    expect(enrollBody).toEqual({ facility_id: FACILITY, action: "enroll_code", device_kind: "kiosk" });

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
    expect(screen.getByTestId("floor-settings-summary")).toHaveTextContent("Med-Tech, Administrator");
    expect(screen.queryByRole("button", { name: "Save floor settings" })).toBeNull();
  });

  it("enrolls a floor tablet, shows its kind, and edits floor settings and per-tablet roles", async () => {
    const floorDevice = { ...device, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", label: "Floor tablet 1", device_kind: "floor", roster_roles: null };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { enabled: true, floor: { idle_lock_minutes: 3, roster_roles: ["med_tech", "facility_admin"] }, devices: [device, floorDevice], can_manage: true }))
      .mockResolvedValueOnce(json(200, { code: "FLOR2345", expires_at: "2026-09-16T12:15:00.000Z", device_kind: "floor" }))
      .mockResolvedValueOnce(json(200, { ok: true }))
      .mockResolvedValueOnce(json(200, { device_id: floorDevice.id, roster_roles: ["med_tech"] }));
    render(<TimeclockTab facilityId={FACILITY} fetchImpl={fetchImpl as unknown as typeof fetch} />);
    expect(await screen.findByText("Floor tablet 1")).toBeInTheDocument();
    expect(screen.getByText("Front-door kiosk", { selector: "span *, span" })).toBeInTheDocument();
    expect(screen.getByText("Facility default (Med-Tech, Administrator)")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("radio", { name: "Floor tablet" }));
    fireEvent.click(screen.getByRole("button", { name: "Enroll a tablet" }));
    expect(await screen.findByTestId("enrollment-instruction")).toHaveTextContent("/floor/setup");
    expect(JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ facility_id: FACILITY, action: "enroll_code", device_kind: "floor" });

    fireEvent.change(screen.getByRole("spinbutton", { name: /idle minutes/ }), { target: { value: "5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save floor settings" }));
    expect(await screen.findByText("Saved.")).toBeInTheDocument();
    expect(JSON.parse(String((fetchImpl.mock.calls[2] as unknown as [string, RequestInit])[1].body))).toEqual({
      facility_id: FACILITY, action: "set_floor_settings", idle_lock_minutes: 5, roster_roles: ["med_tech", "facility_admin"],
    });

    fireEvent.click(screen.getByRole("button", { name: "Change roles for Floor tablet 1" }));
    const picker = screen.getByRole("group", { name: "Roles listed on Floor tablet 1" });
    fireEvent.click(within(picker).getByRole("checkbox", { name: "Administrator" }));
    fireEvent.click(screen.getByRole("button", { name: "Save roles" }));
    await waitFor(() => expect(screen.getAllByText("Med-Tech").length).toBeGreaterThan(0));
    expect(JSON.parse(String((fetchImpl.mock.calls[3] as unknown as [string, RequestInit])[1].body))).toEqual({
      facility_id: FACILITY, action: "set_device_roster_roles", device_id: floorDevice.id, roster_roles: ["med_tech"],
    });
  });
});
