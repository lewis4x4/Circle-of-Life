import React, { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot, type Root } from "react-dom/client";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BILLING_AR_OVERVIEW_REFRESH, BillingArOverviewHero } from "./billing-ar-overview-hero";

const state = vi.hoisted(() => ({
  availableFacilities: [{ id: "site-a", name: "Test facility" }],
  selectedFacilityId: null as string | null,
  setSelectedFacility: vi.fn(),
  syncCookie: vi.fn(),
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (selector: (store: typeof state) => unknown) => selector(state),
}));
vi.mock("@/lib/facilities/selected-facility-cookie", () => ({ syncSelectedFacilityCookie: state.syncCookie }));

beforeEach(() => {
  state.selectedFacilityId = null;
  state.setSelectedFacility.mockReset(); state.syncCookie.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("Billing overview timestamp hydration", () => {
  it.each([
    ["minute boundary", "2026-09-12T23:54:59.999Z", "2026-09-12T23:55:00.001Z", "Sep 12, 2026, 7:55 PM"],
    ["Eastern midnight", "2026-09-13T03:59:59.999Z", "2026-09-13T04:00:00.001Z", "Sep 13, 2026, 12:00 AM"],
    ["same-minute control", "2026-09-12T23:54:10.000Z", "2026-09-12T23:54:59.999Z", "Sep 12, 2026, 7:54 PM"],
  ])("hydrates across %s without replacing server content", async (_name, serverAt, clientAt, expected) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const container = document.createElement("div"); document.body.append(container);
    const recovered: unknown[] = [];
    let root: Root | undefined;
    try {
      vi.setSystemTime(new Date(serverAt));
      container.innerHTML = renderToString(<BillingArOverviewHero />);
      const heading = container.querySelector("h1");
      vi.setSystemTime(new Date(clientAt));
      await act(async () => {
        root = hydrateRoot(container, <BillingArOverviewHero />, { onRecoverableError: error => recovered.push(error) });
      });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      expect(recovered).toEqual([]);
      expect(container.querySelector("h1")).toBe(heading);
      expect(container.textContent).toContain(`As of ${expected} ET`);
    } finally {
      if (root) await act(async () => root!.unmount());
      container.remove();
    }
  });

  it("updates on the minute, the Refresh button and external refresh events, then cleans up", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.setSystemTime(new Date("2026-09-13T12:34:00Z"));
    const view = render(<BillingArOverviewHero />);
    expect(screen.getByText("As of — ET")).toBeVisible();
    act(() => vi.advanceTimersByTime(0));
    expect(screen.getByText("As of Sep 13, 2026, 8:34 AM ET")).toBeVisible();
    act(() => vi.advanceTimersByTime(60_000));
    expect(screen.getByText("As of Sep 13, 2026, 8:35 AM ET")).toBeVisible();
    const refresh = vi.fn(); window.addEventListener(BILLING_AR_OVERVIEW_REFRESH, refresh);
    vi.setSystemTime(new Date("2026-09-13T12:37:00Z"));
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(screen.getByText("As of Sep 13, 2026, 8:37 AM ET")).toBeVisible();
    act(() => {
      vi.setSystemTime(new Date("2026-09-13T12:39:00Z"));
      window.dispatchEvent(new Event(BILLING_AR_OVERVIEW_REFRESH));
    });
    expect(screen.getByText("As of Sep 13, 2026, 8:39 AM ET")).toBeVisible();
    window.removeEventListener(BILLING_AR_OVERVIEW_REFRESH, refresh);
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels the initial clock callback when unmounted before its first tick", () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    const view = render(<BillingArOverviewHero />);
    expect(screen.getByText("As of — ET")).toBeVisible();
    view.unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("retains facility selection and scope-cookie synchronization", () => {
    const view = render(<BillingArOverviewHero />);
    fireEvent.click(screen.getByRole("radio", { name: "Test facility" }));
    expect(state.setSelectedFacility).toHaveBeenLastCalledWith("site-a");
    expect(state.syncCookie).toHaveBeenLastCalledWith("site-a");
    state.selectedFacilityId = "site-a"; view.rerender(<BillingArOverviewHero />);
    expect(screen.getByRole("radio", { name: "Test facility" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "All facilities" }));
    expect(state.setSelectedFacility).toHaveBeenLastCalledWith(null);
    expect(state.syncCookie).toHaveBeenLastCalledWith(null);
  });
});
