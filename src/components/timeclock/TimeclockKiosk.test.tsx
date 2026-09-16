import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { KIOSK_COPY } from "@/lib/timeclock/kiosk-contract";
import { createMemoryKioskStore, pinMemory, type KioskStore } from "@/lib/timeclock/kiosk-store";

import { TimeclockKiosk } from "./TimeclockKiosk";

const DEVICE = { token: "tok", facilityId: "f1", facilityName: "Synthetic facility 0001", enrolledAt: "2026-09-16T10:00:00.000Z" };
const NOW = () => new Date("2026-09-16T11:02:00.000Z");

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function typeCredentials(identifier = "A-100", pin = "123456") {
  const idInput = await screen.findByLabelText(KIOSK_COPY.identifierLabel);
  fireEvent.change(idInput, { target: { value: identifier } });
  fireEvent.change(screen.getByLabelText(KIOSK_COPY.pinLabel), { target: { value: pin } });
  fireEvent.click(screen.getByRole("button", { name: KIOSK_COPY.continueButton }));
}

let store: KioskStore;

beforeEach(() => {
  pinMemory.clear();
  store = createMemoryKioskStore({ device: DEVICE });
});

describe("TimeclockKiosk", () => {
  it("shows the enrollment screen without a device token and confirms the facility after enrolling", async () => {
    const empty = createMemoryKioskStore({ device: null });
    const fetchImpl = vi.fn(async () => json(200, { device_id: "d", token: "new-token", facility_id: "f1", facility_name: "Synthetic facility 0001" }));
    render(<TimeclockKiosk store={empty} fetchImpl={fetchImpl as unknown as typeof fetch} now={NOW} online />);
    expect(await screen.findByRole("heading", { name: KIOSK_COPY.enrollHeading })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(KIOSK_COPY.enrollCodeLabel), { target: { value: "abcd2345" } });
    fireEvent.click(screen.getByRole("button", { name: KIOSK_COPY.enrollButton }));
    expect(await screen.findByRole("heading", { name: "Synthetic facility 0001" })).toBeInTheDocument();
    expect(await screen.findByLabelText(KIOSK_COPY.identifierLabel)).toBeInTheDocument();
    expect((await empty.getDevice())?.token).toBe("new-token");
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].body));
    expect(body.code).toBe("ABCD2345");
  });

  it("identifies, offers only the valid actions, punches, and shows the receipt with worked minutes", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, { first_name: "Test", state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 250 }))
      .mockResolvedValueOnce(json(200, { punch_id: "p", replayed: false, first_name: "Test", punch_type: "out", punched_at: "2026-09-16T11:02:00.000Z", flags: [], state: "out", next_actions: ["in"], today_worked_minutes: 252 }));
    render(<TimeclockKiosk store={store} fetchImpl={fetchImpl as unknown as typeof fetch} now={NOW} online confirmMs={60000} />);
    await typeCredentials();
    expect(await screen.findByRole("button", { name: "Clock out" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Start meal" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Clock in" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Clock out" }));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Clocked out 7:02 a.m.");
    expect(status).toHaveTextContent("4 h 12 min today");
    const punchInit = (fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1];
    expect((punchInit.headers as Record<string, string>)["x-timeclock-device"]).toBe("tok");
    const body = JSON.parse(String(punchInit.body));
    expect(body).toMatchObject({ identifier: "A-100", pin: "123456", punch_type: "out", captured_offline: false });
    expect(body.client_punch_id).toBeTruthy();
    expect(body.device_time).toBe("2026-09-16T11:02:00.000Z");
  });

  it("shows one message for a wrong badge or PIN and clears the inputs", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "not_recognized" }));
    render(<TimeclockKiosk store={store} fetchImpl={fetchImpl as unknown as typeof fetch} now={NOW} online />);
    await typeCredentials("A-100", "000000");
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(KIOSK_COPY.errors.not_recognized);
    const idInput = screen.getByLabelText(KIOSK_COPY.identifierLabel) as HTMLInputElement;
    expect(idInput.value).toBe("");
    expect((screen.getByLabelText(KIOSK_COPY.pinLabel) as HTMLInputElement).value).toBe("");
    expect(idInput).toHaveAttribute("aria-invalid", "true");
    expect(idInput).toHaveAttribute("aria-describedby", "kiosk-error");
  });

  it("shows the lockout, facility-off and not-set-up messages", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(423, { error: "locked" })).mockResolvedValueOnce(json(403, { error: "facility_off" }));
    render(<TimeclockKiosk store={store} fetchImpl={fetchImpl as unknown as typeof fetch} now={NOW} online />);
    await typeCredentials();
    expect(await screen.findByRole("alert")).toHaveTextContent(KIOSK_COPY.errors.locked);
    await typeCredentials();
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(KIOSK_COPY.errors.facility_off));
  });

  it("drops back to enrollment when the server no longer knows the device", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "device_unknown" }));
    render(<TimeclockKiosk store={store} fetchImpl={fetchImpl as unknown as typeof fetch} now={NOW} online />);
    await typeCredentials();
    expect(await screen.findByRole("heading", { name: KIOSK_COPY.enrollHeading })).toBeInTheDocument();
    expect(await store.getDevice()).toBeNull();
  });

  it("queues the punch on this tablet when offline, keeps the PIN in memory only, and replays in order when back online", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const ids = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"];
    const { rerender } = render(
      <TimeclockKiosk store={store} fetchImpl={fetchImpl as unknown as typeof fetch} now={NOW} online={false} confirmMs={10} newClientPunchId={() => ids.shift() ?? "x"} />,
    );
    expect(await screen.findByRole("status")).toHaveTextContent(KIOSK_COPY.offlineBanner);
    await typeCredentials();
    // Offline: every action is offered; the server validates at sync.
    expect(await screen.findByRole("button", { name: "Clock in" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Clock out" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    await screen.findByText(KIOSK_COPY.offlineSaved);
    expect(fetchImpl).not.toHaveBeenCalled();
    await waitFor(async () => expect((await store.listQueue()).length).toBe(1));
    const queued = await store.listQueue();
    expect(JSON.stringify(queued)).not.toContain("123456");
    expect(pinMemory.get(queued[0]!.clientPunchId)).toBe("123456");

    // Second punch while still offline.
    await screen.findByLabelText(KIOSK_COPY.identifierLabel);
    await typeCredentials();
    fireEvent.click(await screen.findByRole("button", { name: "Clock out" }));
    await waitFor(async () => expect((await store.listQueue()).length).toBe(2));

    // Back online: replay in capture order with the remembered PIN.
    const online = vi.fn(async () => json(200, { punch_id: "p", replayed: false, first_name: "Test", punch_type: "in", punched_at: "x", flags: ["offline_capture"], state: "in", next_actions: ["out"], today_worked_minutes: 0 }));
    rerender(<TimeclockKiosk store={store} fetchImpl={online as unknown as typeof fetch} now={NOW} online confirmMs={10} />);
    await waitFor(async () => expect((await store.listQueue()).length).toBe(0));
    const bodies = online.mock.calls.map((call) => JSON.parse(String((call as unknown as [string, RequestInit])[1].body)));
    expect(bodies.map((b) => b.punch_type)).toEqual(["in", "out"]);
    expect(bodies.every((b) => b.captured_offline === true && b.pin === "123456")).toBe(true);
    expect(pinMemory.size).toBe(0);
  });

  it("clears typed input after the idle window", async () => {
    vi.useFakeTimers();
    try {
      const fetchImpl = vi.fn();
      render(<TimeclockKiosk store={store} fetchImpl={fetchImpl as unknown as typeof fetch} now={NOW} online idleMs={1000} />);
      await act(async () => {
        await Promise.resolve();
      });
      const idInput = screen.getByLabelText(KIOSK_COPY.identifierLabel) as HTMLInputElement;
      fireEvent.change(idInput, { target: { value: "A-100" } });
      expect(idInput.value).toBe("A-100");
      await act(async () => {
        vi.advanceTimersByTime(1100);
      });
      expect((screen.getByLabelText(KIOSK_COPY.identifierLabel) as HTMLInputElement).value).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses touch-sized controls and a numeric keypad", async () => {
    render(<TimeclockKiosk store={store} fetchImpl={vi.fn() as unknown as typeof fetch} now={NOW} online />);
    await screen.findByLabelText(KIOSK_COPY.identifierLabel);
    for (const digit of ["1", "5", "0"]) {
      const key = screen.getByRole("button", { name: `Digit ${digit}` });
      expect(key.className).toContain("min-h-[56px]");
      fireEvent.click(key);
    }
    expect((screen.getByLabelText(KIOSK_COPY.pinLabel) as HTMLInputElement).value).toBe("150");
    fireEvent.click(screen.getByRole("button", { name: "Backspace" }));
    expect((screen.getByLabelText(KIOSK_COPY.pinLabel) as HTMLInputElement).value).toBe("15");
    expect(screen.getByLabelText(KIOSK_COPY.pinLabel)).toHaveAttribute("type", "password");
    expect(screen.getByLabelText(KIOSK_COPY.pinLabel)).toHaveAttribute("inputmode", "numeric");
  });
});
