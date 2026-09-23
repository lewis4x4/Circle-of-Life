import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KIOSK_FLOOR_TABLET_LINE, KIOSK_STAFF_COPY } from "@/lib/kiosk/screens";
import { KIOSK_COPY } from "@/lib/timeclock/kiosk-contract";
import { createMemoryKioskStore, pinMemory, type KioskStore } from "@/lib/timeclock/kiosk-store";

import { KioskStaffClock } from "./KioskStaffClock";
import { TEST_DEVICE, json, navigation, renderInKiosk } from "./kiosk-test-utils";

vi.mock("next/navigation", async () => {
  const { navigation: nav } = await import("./kiosk-test-navigation");
  return { usePathname: () => nav.pathname, useRouter: () => nav.router };
});

const RECEIPT = { punch_id: "p", replayed: false, first_name: "Ashley", flags: [], state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 0 };

let store: KioskStore;

beforeEach(() => {
  pinMemory.clear();
  navigation.replace.mockReset();
  store = createMemoryKioskStore({ device: TEST_DEVICE });
});

async function typeNumber(identifier = "1042") {
  fireEvent.change(await screen.findByLabelText(KIOSK_STAFF_COPY.numberLabel), { target: { value: identifier } });
  fireEvent.click(screen.getByRole("button", { name: KIOSK_STAFF_COPY.next }));
}

async function typeCredentials(identifier = "1042", pin = "123456") {
  await typeNumber(identifier);
  fireEvent.change(screen.getByLabelText(KIOSK_STAFF_COPY.pinLabel), { target: { value: pin } });
  fireEvent.click(screen.getByRole("button", { name: KIOSK_STAFF_COPY.continue }));
}

describe("KioskStaffClock", () => {
  it("shows the live clock and the facility once mounted", async () => {
    renderInKiosk(<KioskStaffClock />, { store, pathname: "/kiosk/staff" });
    await waitFor(() => expect(screen.getByTestId("kiosk-clock")).toHaveTextContent("6:58 AM"));
    expect(screen.getByText("Synthetic facility 0001")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: KIOSK_STAFF_COPY.title })).toBeInTheDocument();
  });

  it("types the employee number first, then the PIN, and offers Continue only at 6 digits", async () => {
    renderInKiosk(<KioskStaffClock />, { store, pathname: "/kiosk/staff" });
    const number = (await screen.findByLabelText(KIOSK_STAFF_COPY.numberLabel)) as HTMLInputElement;
    expect(screen.getByText(KIOSK_STAFF_COPY.numberHelper)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KIOSK_STAFF_COPY.next })).toBeDisabled();
    for (const digit of ["1", "0", "4", "2"]) fireEvent.click(screen.getByRole("button", { name: `Digit ${digit}` }));
    expect(number.value).toBe("1042");
    expect(screen.getByRole("button", { name: `Digit 1` }).className).toContain("h-22");
    fireEvent.click(screen.getByRole("button", { name: KIOSK_STAFF_COPY.next }));

    expect(screen.getByText(KIOSK_STAFF_COPY.pinHelper)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: KIOSK_STAFF_COPY.next })).toBeNull();
    const pin = screen.getByLabelText(KIOSK_STAFF_COPY.pinLabel) as HTMLInputElement;
    expect(pin).toHaveAttribute("type", "password");
    for (const digit of ["1", "2", "3", "4", "5"]) fireEvent.click(screen.getByRole("button", { name: `Digit ${digit}` }));
    expect(pin.value).toBe("12345");
    expect(number.value).toBe("1042");
    expect(screen.queryByRole("button", { name: KIOSK_STAFF_COPY.continue })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(pin.value).toBe("1234");
    fireEvent.click(screen.getByRole("button", { name: "Digit 5" }));
    fireEvent.click(screen.getByRole("button", { name: "Digit 6" }));
    fireEvent.click(screen.getByRole("button", { name: "Digit 7" }));
    expect(pin.value).toBe("123456");
    expect(screen.getByRole("button", { name: KIOSK_STAFF_COPY.continue })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(pin.value).toBe("");
  });

  it("moves to the PIN when a badge reader types the number and presses Enter", async () => {
    renderInKiosk(<KioskStaffClock />, { store, pathname: "/kiosk/staff" });
    const number = await screen.findByLabelText(KIOSK_STAFF_COPY.numberLabel);
    fireEvent.change(number, { target: { value: "A-100" } });
    fireEvent.submit(number.closest("form")!);
    expect(screen.getByText(KIOSK_STAFF_COPY.pinHelper)).toBeInTheDocument();
  });

  it("offers one large valid action, with the other valid action beside it, and shows the receipt", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { first_name: "Ashley", state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 250 }))
      .mockResolvedValueOnce(json(200, { ...RECEIPT, punch_type: "out", punched_at: "2026-10-01T10:58:00.000Z", state: "out", next_actions: ["in"], today_worked_minutes: 252 }));
    renderInKiosk(<KioskStaffClock confirmMs={60_000} />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    expect(await screen.findByRole("heading", { name: "Hello, Ashley." })).toBeInTheDocument();
    expect(screen.getByText("You are on the clock.")).toBeInTheDocument();
    const primary = screen.getByRole("button", { name: "Clock out" });
    expect(primary.className).toContain("h-28");
    expect(screen.getByRole("button", { name: "Start meal" }).className).toContain("h-18");
    expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
    fireEvent.click(primary);
    await screen.findByText("Clocked out at 6:58 AM");
    expect(screen.getByText("Ashley · Synthetic facility 0001 · 4 h 12 min today")).toBeInTheDocument();
    expect(screen.getByText(KIOSK_FLOOR_TABLET_LINE.out)).toBeInTheDocument();
    const punchInit = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((punchInit.headers as Record<string, string>)["x-timeclock-device"]).toBe("tok");
    expect(punchInit.credentials).toBe("omit");
    const body = JSON.parse(String(punchInit.body));
    expect(body).toMatchObject({ identifier: "1042", pin: "123456", punch_type: "out", captured_offline: false, device_time: "2026-10-01T10:58:00.000Z" });
    expect(body.client_punch_id).toBeTruthy();
  });

  it("confirms a clock in with the floor-tablet line and returns home after the confirmation", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { first_name: "Ashley", state: "out", next_actions: ["in"], today_worked_minutes: 0 }))
      .mockResolvedValueOnce(json(200, { ...RECEIPT, punch_type: "in", punched_at: "2026-10-01T10:58:00.000Z" }));
    renderInKiosk(<KioskStaffClock confirmMs={20} />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    expect(await screen.findByText("You are off the clock.")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /Clock|meal/ })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Clocked in at 6:58 AM");
    expect(status).toHaveTextContent("Ashley · Synthetic facility 0001");
    expect(status).toHaveTextContent(KIOSK_FLOOR_TABLET_LINE.in);
    expect(status).toHaveTextContent(KIOSK_STAFF_COPY.clears);
    expect(screen.queryByRole("link", { name: "Back" })).toBeNull();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/kiosk"));
  });

  it("shows the last clock out and the display name when the database sends them (screens 12, 13)", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { first_name: "Ashley", display_name: "Ashley W.", last_out_at: "2026-09-30T23:06:00.000Z", state: "out", next_actions: ["in"], today_worked_minutes: 0 }))
      .mockResolvedValueOnce(json(200, { ...RECEIPT, display_name: "Ashley W.", last_out_at: "2026-09-30T23:06:00.000Z", punch_type: "in", punched_at: "2026-10-01T10:58:00.000Z" }));
    renderInKiosk(<KioskStaffClock confirmMs={60_000} />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    expect(await screen.findByText("You are off the clock. Last clock out: Wednesday, 7:06 PM.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    expect(await screen.findByText("Ashley W. · Synthetic facility 0001")).toBeInTheDocument();
  });

  it("says one thing for a wrong number or PIN and clears both", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "not_recognized" }));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials("1042", "000000");
    await screen.findByText(KIOSK_COPY.errors.not_recognized);
    const number = screen.getByLabelText(KIOSK_STAFF_COPY.numberLabel) as HTMLInputElement;
    expect(number.value).toBe("");
    expect((screen.getByLabelText(KIOSK_STAFF_COPY.pinLabel) as HTMLInputElement).value).toBe("");
    expect(number).toHaveAttribute("aria-invalid", "true");
    expect(number).toHaveAttribute("aria-describedby", "kiosk-error");
    expect(document.getElementById("kiosk-error")).toHaveAttribute("role", "status");
  });

  it("shows the lockout and facility-off messages", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(423, { error: "locked" })).mockResolvedValueOnce(json(403, { error: "facility_off" }));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    await screen.findByText(KIOSK_COPY.errors.locked);
    await typeCredentials();
    await screen.findByText(KIOSK_COPY.errors.facility_off);
  });

  it("drops the device and goes to setup when the server no longer knows the tablet", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "device_unknown" }));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/kiosk/setup"));
    expect(await store.getDevice()).toBeNull();
  });

  it("queues punches on this tablet when offline, keeps the PIN in memory only, and replays in order when back online", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const view = renderInKiosk(<KioskStaffClock confirmMs={60_000} newClientPunchId={() => ids.shift() ?? "x"} />, {
      store,
      fetchImpl,
      online: false,
      pathname: "/kiosk/staff",
    });
    expect(await screen.findByText(new RegExp(KIOSK_COPY.offlineBanner.slice(0, 20)))).toBeInTheDocument();
    await typeCredentials();
    // Offline: every action is offered; the server validates at sync.
    expect(await screen.findByRole("button", { name: "Clock in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock out" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    await screen.findByText(KIOSK_COPY.offlineSaved);
    expect(screen.getByText("Clock in saved at 6:58 AM")).toBeInTheDocument();
    expect(fetchImpl).not.toHaveBeenCalled();
    const queued = await store.listQueue();
    expect(queued).toHaveLength(1);
    expect(JSON.stringify(queued)).not.toContain("123456");
    expect(pinMemory.get(queued[0]!.clientPunchId)).toBe("123456");

    // Back online: replay in capture order with the remembered PIN.
    const online = vi.fn(async () => json(200, { ...RECEIPT, punch_type: "in", punched_at: "x", flags: ["offline_capture"] }));
    view.rerenderWith({ fetchImpl: online, online: true });
    await waitFor(async () => expect((await store.listQueue()).length).toBe(0));
    const bodies = online.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies.map((b) => b.punch_type)).toEqual(["in"]);
    expect(bodies.every((b) => b.captured_offline === true && b.pin === "123456")).toBe(true);
    expect(pinMemory.size).toBe(0);
  });

  it("returns to the number box when the person taps Not you", async () => {
    const fetchImpl = vi.fn(async () => json(200, { first_name: "Ashley", state: "out", next_actions: ["in"], today_worked_minutes: 0 }));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    fireEvent.click(await screen.findByRole("button", { name: KIOSK_STAFF_COPY.notYou }));
    expect(((await screen.findByLabelText(KIOSK_STAFF_COPY.numberLabel)) as HTMLInputElement).value).toBe("");
  });
});
