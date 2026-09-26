import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { KIOSK_LEAVING_COPY } from "@/lib/kiosk/screens";

import { KioskLeaving } from "./KioskLeaving";
import { json, navigation, renderInKiosk } from "./kiosk-test-utils";

vi.mock("next/navigation", async () => {
  const { navigation: nav } = await import("./kiosk-test-navigation");
  return { usePathname: () => nav.pathname, useRouter: () => nav.router };
});

const MATCHES = {
  matches: [
    { entry_id: "11111111-1111-4111-8111-111111111111", display_name: "Carol P.", type_label: "Visiting a resident", checked_in_at: "2026-10-01T14:12:00.000Z" },
    { entry_id: "22222222-2222-4222-8222-222222222222", display_name: "Carlos M.", type_label: "Vendor or contractor", checked_in_at: "2026-10-01T13:48:00.000Z" },
  ],
};

beforeEach(() => {
  navigation.replace.mockReset();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("KioskLeaving", () => {
  it("lists nothing and asks nothing before three letters", async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => json(200, MATCHES));
    renderInKiosk(<KioskLeaving />, { fetchImpl, pathname: "/kiosk/leaving" });
    await act(async () => {
      await Promise.resolve();
    });
    const input = screen.getByLabelText(KIOSK_LEAVING_COPY.nameLabel);
    for (const value of ["C", "Ca", "Ca ", "C4r", "Ca-"]) {
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        vi.advanceTimersByTime(2000);
      });
      expect(screen.queryByRole("list", { name: "Open visits" })).toBeNull();
      expect(screen.queryByText("Carol P.")).toBeNull();
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("lists matches after three letters and signs one out", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json(200, MATCHES))
      .mockResolvedValueOnce(json(200, { checked_in_at: "2026-10-01T14:12:00.000Z", checked_out_at: "2026-10-01T15:40:00.000Z", display_name: "Carol P." }));
    renderInKiosk(<KioskLeaving debounceMs={0} />, { fetchImpl, pathname: "/kiosk/leaving" });
    fireEvent.change(await screen.findByLabelText(KIOSK_LEAVING_COPY.nameLabel), { target: { value: "Car" } });
    const row = await screen.findByRole("button", { name: /Sign out Carol P\./ });
    expect(screen.getByText(KIOSK_LEAVING_COPY.hint)).toBeInTheDocument();
    expect(screen.getByText(KIOSK_LEAVING_COPY.nameHelper)).toBeInTheDocument();
    expect(screen.getByText("Visiting a resident · In at 10:12 AM")).toBeInTheDocument();
    expect(screen.getByText("Vendor or contractor · In at 9:48 AM")).toBeInTheDocument();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/kiosk/visitor/open?prefix=Car");
    expect((init.headers as Record<string, string>)["x-timeclock-device"]).toBe("tok");
    fireEvent.click(row);
    // Nothing is written until the visitor confirms.
    const sheet = screen.getByRole("dialog", { name: "Sign out Carol P.?" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(within(sheet).getByRole("button", { name: KIOSK_LEAVING_COPY.signOut })).toHaveFocus();
    fireEvent.click(within(sheet).getByRole("button", { name: KIOSK_LEAVING_COPY.signOut }));
    expect(await screen.findByText("You're signed out. Thanks, Carol.")).toBeInTheDocument();
    expect(screen.getByText("In 10:12 AM · Out 11:40 AM")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();
    expect(JSON.parse(String((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[1].body))).toEqual({ entry_id: MATCHES.matches[0]!.entry_id });
  });

  it("closes the sheet on Cancel without signing anyone out", async () => {
    const fetchImpl = vi.fn(async () => json(200, MATCHES));
    renderInKiosk(<KioskLeaving debounceMs={0} />, { fetchImpl, pathname: "/kiosk/leaving" });
    fireEvent.change(await screen.findByLabelText(KIOSK_LEAVING_COPY.nameLabel), { target: { value: "Car" } });
    fireEvent.click(await screen.findByRole("button", { name: /Sign out Carlos M\./ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: KIOSK_LEAVING_COPY.cancel }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["already_signed_out", 409, "That visit is already signed out."],
    ["not_found", 404, "No open visit under that name. Ask the front desk to sign you out."],
    ["device_throttled", 429, "Too many tries. Ask the front desk."],
  ])("says %s in the screen's own words", async (code, status, copy) => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(json(200, MATCHES)).mockResolvedValueOnce(json(status, { error: code }));
    renderInKiosk(<KioskLeaving debounceMs={0} />, { fetchImpl, pathname: "/kiosk/leaving" });
    fireEvent.change(await screen.findByLabelText(KIOSK_LEAVING_COPY.nameLabel), { target: { value: "Car" } });
    fireEvent.click(await screen.findByRole("button", { name: /Sign out Carol P\./ }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: KIOSK_LEAVING_COPY.signOut }));
    expect(await screen.findByText(copy)).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("sends an unenrolled tablet to setup", async () => {
    const fetchImpl = vi.fn(async () => json(401, { error: "device_unknown" }));
    renderInKiosk(<KioskLeaving debounceMs={0} />, { fetchImpl, pathname: "/kiosk/leaving" });
    fireEvent.change(await screen.findByLabelText(KIOSK_LEAVING_COPY.nameLabel), { target: { value: "Car" } });
    await waitFor(() => expect(navigation.replace).toHaveBeenCalledWith("/kiosk/setup"));
  });

  it("returns home after 60 seconds without input, not 30", async () => {
    vi.useFakeTimers();
    renderInKiosk(<KioskLeaving />, { pathname: "/kiosk/leaving" });
    await act(async () => {
      await Promise.resolve();
    });
    await act(async () => {
      vi.advanceTimersByTime(45_000);
    });
    expect(navigation.replace).not.toHaveBeenCalledWith("/kiosk");
    await act(async () => {
      vi.advanceTimersByTime(15_001);
    });
    expect(navigation.replace).toHaveBeenCalledWith("/kiosk");
  });

  it("says so when nobody matches", async () => {
    const fetchImpl = vi.fn(async () => json(200, { matches: [] }));
    renderInKiosk(<KioskLeaving debounceMs={0} />, { fetchImpl, pathname: "/kiosk/leaving" });
    fireEvent.change(await screen.findByLabelText(KIOSK_LEAVING_COPY.nameLabel), { target: { value: "Zed" } });
    await waitFor(() => expect(screen.getByText(KIOSK_LEAVING_COPY.none)).toBeInTheDocument());
  });

  it("says the kiosk is busy when the search is throttled", async () => {
    const fetchImpl = vi.fn(async () => json(429, { error: "device_throttled" }));
    renderInKiosk(<KioskLeaving debounceMs={0} />, { fetchImpl, pathname: "/kiosk/leaving" });
    fireEvent.change(await screen.findByLabelText(KIOSK_LEAVING_COPY.nameLabel), { target: { value: "Car" } });
    const busy = await screen.findByText(KIOSK_LEAVING_COPY.errors.device_throttled);
    expect(busy.closest("[role=status]")).not.toBeNull();
  });
});
