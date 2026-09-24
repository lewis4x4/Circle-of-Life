import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  router: null as unknown as { replace: (href: string) => void; push: () => void; back: () => void },
  signOut: vi.fn(() => Promise.resolve({ error: null })),
  device: {
    deviceId: "device-1",
    token: "device-token",
    facilityId: "facility-1",
    facilityName: "Homewood Lodge",
    deviceLabel: "HL-FLOOR-02",
    enrolledAt: "2026-09-23T10:00:00Z",
  },
}));

mocks.router = { replace: (href: string) => mocks.replace(href), push: () => undefined, back: () => undefined };

vi.mock("next/navigation", () => ({
  useRouter: () => mocks.router,
  usePathname: () => "/floor",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { signOut: mocks.signOut }, rpc: vi.fn(() => Promise.resolve({ data: null, error: new Error("offline") })) }),
}));
vi.mock("@/lib/floor/device-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/floor/device-store")>();
  return { ...actual, resolveFloorDeviceStore: () => actual.createMemoryFloorDeviceStore(mocks.device) };
});
vi.mock("@/lib/caregiver/facility-context", () => ({
  workingFacilityKey: (userId: string) => `haven:working-facility:${userId}`,
  loadCaregiverFacilityContext: () =>
    Promise.resolve({ ok: true, ctx: { facilityId: "facility-1", organizationId: "org-1", facilityName: "Homewood Lodge", timeZone: "America/New_York", shifts: [] } }),
}));
vi.mock("@/lib/floor/replay", () => ({ replayFloorQueues: () => Promise.resolve(), countUnsentByOwner: () => Promise.resolve({}) }));
const refreshRounding = () => Promise.resolve();
vi.mock("@/hooks/useRoundingOfflineSync", () => ({ useRoundingOfflineSync: () => ({ pendingCount: 0, queuedTaskIdSet: new Set(), refresh: refreshRounding }) }));
vi.mock("@/lib/offline/care-event-queue", () => ({
  requestCareEventQueueState: () => Promise.resolve({ pendingCount: 0, isSyncing: false, lastError: null, sent: [] }),
  subscribeCareEventQueue: () => () => undefined,
}));

import { currentFloorUnlockId, setFloorUnlockId } from "@/lib/floor/session-context";
import { currentFloorUnlockProfile, setFloorUnlockProfile } from "@/lib/floor/unlock-profile";

import { FloorShell } from "./FloorShell";

function setOnline(value: boolean) {
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => value });
}

describe("FloorShell lock with no network", () => {
  beforeEach(() => {
    mocks.replace.mockClear();
    setFloorUnlockId("11111111-1111-4111-8111-111111111111");
    setFloorUnlockProfile({
      unlockId: "11111111-1111-4111-8111-111111111111",
      userId: "user-ashley",
      displayName: "Ashley W.",
      initials: "AW",
      roleLabel: "Med tech",
      clockedInAt: "2026-09-23T10:58:00Z",
      onClock: true,
      idleLockMinutes: 3,
      unlockedAt: "2026-09-23T11:00:00Z",
    });
    document.cookie = "sb-ref-auth-token.0=session; path=/";
    vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new TypeError("Failed to fetch"))));
  });

  afterEach(() => {
    setOnline(true);
    vi.unstubAllGlobals();
  });

  it("reaches a locked screen in place, forgets the person, and moves to /floor/lock when the network returns", async () => {
    render(
      <FloorShell>
        <p>Evelyn Carter, Safety check</p>
      </FloorShell>,
    );
    await screen.findByText("Evelyn Carter, Safety check");

    setOnline(false);
    fireEvent.click(screen.getByRole("button", { name: /Switch/ }));

    // The person's screen is gone at once, without the network, and nothing navigated yet.
    await waitFor(() => expect(screen.queryByText("Evelyn Carter, Safety check")).toBeNull());
    expect(screen.getByRole("heading", { name: "Who's on shift?" })).toBeInTheDocument();
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(currentFloorUnlockId()).toBeNull();
    expect(currentFloorUnlockProfile()).toBeNull();
    expect(document.cookie).not.toContain("sb-ref-auth-token");
    expect(mocks.signOut).toHaveBeenCalledWith({ scope: "local" });

    // Back online: the tablet goes to the lock route.
    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/floor/lock"));
    const before = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 800));
    const after = (fetch as unknown as { mock: { calls: unknown[] } }).mock.calls.length;
    // Settled: coming back online sends the retried lock and one roster read, not a loop.
    expect(after - before).toBeLessThan(5);
    expect(mocks.replace).toHaveBeenCalledWith("/floor/lock");
  });
});
