import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}), isBrowserSupabaseConfigured: () => true }));
vi.mock("@/lib/caregiver/facility-context", () => ({
  loadCaregiverFacilityContext: vi.fn(async () => ({
    ok: true,
    ctx: { facilityId: "facility-a", facilityName: "Homewood Lodge" },
  })),
}));
vi.mock("@/hooks/useRoundingOfflineSync", () => ({
  useRoundingOfflineSync: () => ({ queuedTaskIdSet: new Set<string>(), pendingCount: 0, online: true, isSyncing: false }),
}));
vi.mock("@/components/caregiver/FloorWorkflowStrip", () => ({ FloorWorkflowStrip: () => null }));
vi.mock("@/lib/rounding/rounding-query-error", () => ({
  logRoundingQueryFailure: (_scope: string, _error: unknown, message: string) => message,
}));

import CaregiverRoundsPage from "./page";

afterEach(() => vi.unstubAllGlobals());

it("shows unknown counts, not Critical 0 / Due now 0, after the queue read is refused (COL-649)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ error: "No caregiver staff profile found" }), { status: 403 })),
  );
  await act(async () => {
    render(<CaregiverRoundsPage />);
  });
  expect(screen.getByText(/counts below are unknown/)).toBeTruthy();
  expect(screen.queryByText(/Pull to refresh/)).toBeNull();
  expect(screen.getAllByText("Unavailable")).toHaveLength(4);
  expect(screen.queryByText("No critical rounds right now.")).toBeNull();
});

it("shows real counts once the queue loads", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ tasks: [] }))));
  await act(async () => {
    render(<CaregiverRoundsPage />);
  });
  expect(screen.queryByText("Unavailable")).toBeNull();
});
