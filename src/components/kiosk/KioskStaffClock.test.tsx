import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KIOSK_FLOOR_TABLET_LINE, KIOSK_STAFF_COPY } from "@/lib/kiosk/screens";
import { KIOSK_COPY, KIOSK_ROSTER_ENDPOINT, type KioskRosterEntry } from "@/lib/timeclock/kiosk-contract";
import { createMemoryKioskStore, pinMemory, type KioskStore } from "@/lib/timeclock/kiosk-store";

import { KioskStaffClock } from "./KioskStaffClock";
import { TEST_DEVICE, json, navigation, renderInKiosk } from "./kiosk-test-utils";

vi.mock("next/navigation", async () => {
  const { navigation: nav } = await import("./kiosk-test-navigation");
  return { usePathname: () => nav.pathname, useRouter: () => nav.router };
});

const RECEIPT = { punch_id: "p", replayed: false, first_name: "Ashley", flags: [], state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 0 };

const ASHLEY = { staff_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", display_name: "Ashley W." };
const ROSTER: KioskRosterEntry[] = [ASHLEY, { staff_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", display_name: "Brian L." }, { staff_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", display_name: "Rita S." }];

let store: KioskStore;

beforeEach(() => {
  pinMemory.clear();
  navigation.replace.mockReset();
  store = createMemoryKioskStore({ device: TEST_DEVICE });
});
afterEach(() => {
  vi.useRealTimers();
});

type Call = [string, RequestInit];

/** A fetch that answers the name list itself and hands every other call to `inner`. */
function withRoster(inner: (url: string, init: RequestInit) => Promise<Response> = async () => json(500, {}), roster: () => Response = () => json(200, { roster: ROSTER, throttled_until: null })) {
  return vi.fn(async (url: string, init: RequestInit) => (String(url) === KIOSK_ROSTER_ENDPOINT ? roster() : inner(url, init)));
}

/** Only the identify and punch calls, in order. */
function staffCalls(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
  return (fetchImpl.mock.calls as unknown as Call[]).filter(([url]) => String(url) !== KIOSK_ROSTER_ENDPOINT);
}

function sequence(...responses: Response[]) {
  const queue = [...responses];
  return async () => queue.shift() ?? json(500, {});
}

async function openNumberScreen() {
  fireEvent.click(await screen.findByRole("button", { name: KIOSK_STAFF_COPY.useNumber }));
}

async function typeNumber(identifier = "1042") {
  if (!screen.queryByLabelText(KIOSK_STAFF_COPY.numberLabel)) await openNumberScreen();
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
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl: withRoster(), pathname: "/kiosk/staff" });
    await openNumberScreen();
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
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl: withRoster(), pathname: "/kiosk/staff" });
    await openNumberScreen();
    const number = await screen.findByLabelText(KIOSK_STAFF_COPY.numberLabel);
    fireEvent.change(number, { target: { value: "A-100" } });
    fireEvent.submit(number.closest("form")!);
    expect(screen.getByText(KIOSK_STAFF_COPY.pinHelper)).toBeInTheDocument();
  });

  it("offers one large valid action, with the other valid action beside it, and shows the receipt", async () => {
    const fetchImpl = withRoster(
      sequence(
        json(200, { first_name: "Ashley", state: "in", next_actions: ["out", "meal_start"], today_worked_minutes: 250 }),
        json(200, { ...RECEIPT, punch_type: "out", punched_at: "2026-10-01T10:58:00.000Z", state: "out", next_actions: ["in"], today_worked_minutes: 252 }),
      ),
    );
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
    const punchInit = staffCalls(fetchImpl)[1]![1];
    expect((punchInit.headers as Record<string, string>)["x-timeclock-device"]).toBe("tok");
    expect(punchInit.credentials).toBe("omit");
    const body = JSON.parse(String(punchInit.body));
    expect(body).toMatchObject({ identifier: "1042", pin: "123456", punch_type: "out", captured_offline: false, device_time: "2026-10-01T10:58:00.000Z" });
    expect(body.client_punch_id).toBeTruthy();
  });

  it("confirms a clock in with the floor-tablet line and returns home after the confirmation", async () => {
    const fetchImpl = withRoster(
      sequence(
        json(200, { first_name: "Ashley", state: "out", next_actions: ["in"], today_worked_minutes: 0 }),
        json(200, { ...RECEIPT, punch_type: "in", punched_at: "2026-10-01T10:58:00.000Z" }),
      ),
    );
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
    const fetchImpl = withRoster(
      sequence(
        json(200, { first_name: "Ashley", display_name: "Ashley W.", last_out_at: "2026-09-30T23:06:00.000Z", state: "out", next_actions: ["in"], today_worked_minutes: 0 }),
        json(200, { ...RECEIPT, display_name: "Ashley W.", last_out_at: "2026-09-30T23:06:00.000Z", punch_type: "in", punched_at: "2026-10-01T10:58:00.000Z" }),
      ),
    );
    renderInKiosk(<KioskStaffClock confirmMs={60_000} />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    expect(await screen.findByText("You are off the clock. Last clock out: Wednesday, 7:06 PM.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clock in" }));
    expect(await screen.findByText("Ashley W. · Synthetic facility 0001")).toBeInTheDocument();
  });

  it("says one thing for a wrong number or PIN and clears both", async () => {
    // The server never sends tries_left on this path; even if it did, the screen would not say it.
    const fetchImpl = withRoster(async () => json(401, { error: "not_recognized", tries_left: 3 }));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials("1042", "000000");
    expect(screen.queryByText(/tries left/)).toBeNull();
    await screen.findByText(KIOSK_COPY.errors.not_recognized);
    const number = screen.getByLabelText(KIOSK_STAFF_COPY.numberLabel) as HTMLInputElement;
    expect(number.value).toBe("");
    expect((screen.getByLabelText(KIOSK_STAFF_COPY.pinLabel) as HTMLInputElement).value).toBe("");
    expect(number).toHaveAttribute("aria-invalid", "true");
    expect(number).toHaveAttribute("aria-describedby", "kiosk-error");
    expect(document.getElementById("kiosk-error")).toHaveAttribute("role", "status");
  });

  it("shows the lockout and facility-off messages", async () => {
    const fetchImpl = withRoster(sequence(json(423, { error: "locked" }), json(403, { error: "facility_off" })));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    await screen.findByText(KIOSK_COPY.errors.locked);
    await typeCredentials();
    await screen.findByText(KIOSK_COPY.errors.facility_off);
  });

  it("drops the device and goes to setup when the server no longer knows the tablet", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "device_unknown" }));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
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
    const bodies = staffCalls(online).map(([, init]) => JSON.parse(String(init.body)));
    expect(bodies.map((b) => b.punch_type)).toEqual(["in"]);
    expect(bodies.every((b) => b.captured_offline === true && b.pin === "123456")).toBe(true);
    expect(pinMemory.size).toBe(0);
  });

  it("returns to the name list when the person taps Not you", async () => {
    const fetchImpl = withRoster(async () => json(200, { first_name: "Ashley", state: "out", next_actions: ["in"], today_worked_minutes: 0 }));
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await typeCredentials();
    fireEvent.click(await screen.findByRole("button", { name: KIOSK_STAFF_COPY.notYou }));
    expect(await screen.findByRole("heading", { name: KIOSK_STAFF_COPY.tapName })).toBeInTheDocument();
  });
});

describe("KioskStaffClock name picker", () => {
  async function tapName(name = "Ashley W.") {
    fireEvent.click(await within(await screen.findByRole("list", { name: KIOSK_STAFF_COPY.namesLabel })).findByRole("button", { name }));
  }

  function enterPin(pin: string) {
    for (const digit of pin) fireEvent.click(screen.getByRole("button", { name: `Digit ${digit}` }));
    fireEvent.click(screen.getByRole("button", { name: KIOSK_STAFF_COPY.continue }));
  }

  it("opens on Tap your name with the list, the filter and the way to the employee-number screen", async () => {
    const fetchImpl = withRoster();
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    expect(await screen.findByRole("heading", { level: 2, name: KIOSK_STAFF_COPY.tapName })).toBeInTheDocument();
    const list = await screen.findByRole("list", { name: KIOSK_STAFF_COPY.namesLabel });
    expect(within(list).getAllByRole("button").map((b) => b.textContent)).toEqual(["Ashley W.", "Brian L.", "Rita S."]);
    expect(list.className).toContain("grid-cols-3");
    expect(list.className).toContain("landscape:grid-cols-4");
    expect(within(list).getAllByRole("button")[0]!.className).toContain("min-h-18");
    expect(screen.getByPlaceholderText(KIOSK_STAFF_COPY.filterPlaceholder)).toBeInTheDocument();
    expect(screen.getByText(KIOSK_STAFF_COPY.notOnList)).toBeInTheDocument();
    expect(screen.queryByText(KIOSK_STAFF_COPY.numberHelper)).toBeNull();
    expect(screen.queryByLabelText(KIOSK_STAFF_COPY.numberLabel)).toBeNull();
    const [url, init] = (fetchImpl.mock.calls as unknown as Call[])[0]!;
    expect(url).toBe(KIOSK_ROSTER_ENDPOINT);
    expect((init.headers as Record<string, string>)["x-timeclock-device"]).toBe("tok");
    // The list is saved for when the tablet is offline.
    await waitFor(async () => expect((await store.getRoster())?.roster).toEqual(ROSTER));
    await openNumberScreen();
    expect(screen.getByText(KIOSK_STAFF_COPY.numberHelper)).toBeInTheDocument();
  });

  it("narrows the tiles on every keystroke, from the first letter", async () => {
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl: withRoster(), pathname: "/kiosk/staff" });
    const filter = await screen.findByPlaceholderText(KIOSK_STAFF_COPY.filterPlaceholder);
    await screen.findByRole("list", { name: KIOSK_STAFF_COPY.namesLabel });
    fireEvent.change(filter, { target: { value: "r" } });
    expect(within(screen.getByRole("list", { name: KIOSK_STAFF_COPY.namesLabel })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Rita S."]);
    fireEvent.change(filter, { target: { value: "l" } });
    expect(within(screen.getByRole("list", { name: KIOSK_STAFF_COPY.namesLabel })).getAllByRole("button").map((b) => b.textContent)).toEqual(["Brian L."]);
    fireEvent.change(filter, { target: { value: "zz" } });
    expect(screen.getByText(KIOSK_STAFF_COPY.noFilterMatch)).toBeInTheDocument();
  });

  it("taps a name, takes the PIN, and identifies and punches with staff_id and no employee number", async () => {
    const fetchImpl = withRoster(
      sequence(
        json(200, { first_name: "Ashley", display_name: "Ashley W.", state: "out", next_actions: ["in"], today_worked_minutes: 0 }),
        json(200, { ...RECEIPT, display_name: "Ashley W.", punch_type: "in", punched_at: "2026-10-01T10:58:00.000Z" }),
      ),
    );
    renderInKiosk(<KioskStaffClock confirmMs={60_000} />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await tapName();
    expect(screen.getByRole("heading", { level: 2, name: "Ashley W." })).toBeInTheDocument();
    expect(screen.getByLabelText(KIOSK_STAFF_COPY.pinLabel)).toHaveAttribute("type", "password");
    enterPin("123456");
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    await screen.findByText("Clocked in at 6:58 AM");
    const [identify, punch] = staffCalls(fetchImpl);
    expect(JSON.parse(String(identify![1].body))).toEqual({ staff_id: ASHLEY.staff_id, pin: "123456" });
    const punchBody = JSON.parse(String(punch![1].body));
    expect(punchBody).toMatchObject({ staff_id: ASHLEY.staff_id, pin: "123456", punch_type: "in", captured_offline: false });
    expect(punchBody).not.toHaveProperty("identifier");
  });

  it("Not you? goes back to the list and clears the PIN", async () => {
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl: withRoster(), pathname: "/kiosk/staff" });
    await tapName();
    fireEvent.click(screen.getByRole("button", { name: "Digit 1" }));
    fireEvent.click(screen.getByRole("button", { name: KIOSK_STAFF_COPY.notYouShort }));
    expect(await screen.findByRole("heading", { name: KIOSK_STAFF_COPY.tapName })).toBeInTheDocument();
    await tapName("Brian L.");
    expect((screen.getByLabelText(KIOSK_STAFF_COPY.pinLabel) as HTMLInputElement).value).toBe("");
  });

  it.each([
    [{ error: "not_recognized", tries_left: 3 }, 401, "Wrong PIN. 3 tries left."],
    [{ error: "not_recognized", tries_left: 1 }, 401, "Wrong PIN. 1 try left."],
    [{ error: "not_recognized", tries_left: 0 }, 401, "Locked for 15 minutes. Ask a manager to unlock you."],
    [{ error: "locked" }, 423, "Locked for 15 minutes. Ask a manager to unlock you."],
    [{ error: "not_set_up" }, 403, "You're not set up to clock in here. Ask your manager."],
    [{ error: "facility_off" }, 403, KIOSK_COPY.errors.facility_off],
  ])("says %j on the PIN screen and clears the PIN", async (body, status, copy) => {
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl: withRoster(async () => json(status, body)), pathname: "/kiosk/staff" });
    await tapName();
    enterPin("000000");
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Ashley W." })).toBeInTheDocument();
    expect((screen.getByLabelText(KIOSK_STAFF_COPY.pinLabel) as HTMLInputElement).value).toBe("");
  });

  it("holds the tiles and says until when while the tablet is throttled", async () => {
    let throttled = false;
    const fetchImpl = withRoster(
      async () => {
        throttled = true;
        return json(429, { error: "device_throttled" });
      },
      () => json(200, { roster: ROSTER, throttled_until: throttled ? "2026-10-01T11:40:00.000Z" : null }),
    );
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await tapName();
    enterPin("000000");
    expect(await screen.findByText("Too many wrong PINs on this tablet. Try again at 7:40 AM.")).toBeInTheDocument();
    const tiles = within(screen.getByRole("list", { name: KIOSK_STAFF_COPY.namesLabel })).getAllByRole("button");
    expect(tiles.every((tile) => (tile as HTMLButtonElement).disabled)).toBe(true);
  });

  it("goes back to the list after 30 seconds on the PIN screen, and the shell sends the list home after 60", async () => {
    vi.useFakeTimers();
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl: withRoster(), pathname: "/kiosk/staff" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    fireEvent.click(within(screen.getByRole("list", { name: KIOSK_STAFF_COPY.namesLabel })).getByRole("button", { name: "Ashley W." }));
    fireEvent.click(screen.getByRole("button", { name: "Digit 4" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(screen.getByRole("heading", { name: KIOSK_STAFF_COPY.tapName })).toBeInTheDocument();
    expect(navigation.replace).not.toHaveBeenCalledWith("/kiosk");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_001);
    });
    expect(navigation.replace).toHaveBeenCalledWith("/kiosk");
  });

  it("asks for the list again every 5 minutes while open", async () => {
    const fetchImpl = withRoster();
    renderInKiosk(<KioskStaffClock rosterRefreshMs={40} />, { store, fetchImpl, pathname: "/kiosk/staff" });
    await waitFor(() => expect((fetchImpl.mock.calls as unknown as Call[]).filter(([url]) => url === KIOSK_ROSTER_ENDPOINT).length).toBeGreaterThanOrEqual(3));
  });

  it("shows the saved names with no connection, queues a name punch with staff_id and no PIN on disk, and replays it", async () => {
    store = createMemoryKioskStore({ device: TEST_DEVICE, roster: { facilityId: TEST_DEVICE.facilityId, fetchedAt: "2026-09-30T10:00:00.000Z", roster: ROSTER } });
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    const view = renderInKiosk(<KioskStaffClock confirmMs={60_000} newClientPunchId={() => "33333333-3333-4333-8333-333333333333"} />, {
      store,
      fetchImpl,
      online: false,
      pathname: "/kiosk/staff",
    });
    await tapName();
    enterPin("482913");
    fireEvent.click(await screen.findByRole("button", { name: "Clock in" }));
    await screen.findByText(KIOSK_COPY.offlineSaved);
    const queued = await store.listQueue();
    expect(queued).toEqual([expect.objectContaining({ staffId: ASHLEY.staff_id, identifier: "", punchType: "in" })]);
    expect(JSON.stringify(queued)).not.toContain("482913");
    expect(pinMemory.get(queued[0]!.clientPunchId)).toBe("482913");

    const online = withRoster(async () => json(200, { ...RECEIPT, punch_type: "in", punched_at: "x", flags: ["offline_capture"] }));
    view.rerenderWith({ fetchImpl: online, online: true });
    await waitFor(async () => expect((await store.listQueue()).length).toBe(0));
    const replayed = JSON.parse(String(staffCalls(online)[0]![1].body));
    expect(replayed).toMatchObject({ staff_id: ASHLEY.staff_id, pin: "482913", captured_offline: true, punch_type: "in" });
    expect(replayed).not.toHaveProperty("identifier");
  });

  it("says the tablet has no saved names when offline for the first time, and still offers the employee number", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    });
    renderInKiosk(<KioskStaffClock />, { store, fetchImpl, online: false, pathname: "/kiosk/staff" });
    expect(await screen.findByText(KIOSK_STAFF_COPY.offlineNoNames)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: KIOSK_STAFF_COPY.useNumber })).toBeInTheDocument();
  });
});
