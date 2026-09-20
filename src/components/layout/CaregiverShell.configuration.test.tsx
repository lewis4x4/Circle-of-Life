import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ shifts: vi.fn(), ready: false, lastError: null as string | null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/caregiver/rounds", useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: "caregiver", loading: false, organizationId: "org", user: { id: "user", app_metadata: { app_role: "caregiver" } } }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContextForUser: async () => ({ ok: true, ctx: { facilityId: "facility", facilityName: "Synthetic facility", timeZone: "America/New_York" } }) }));
vi.mock("@/lib/rounding/live-board-fetch", () => ({ fetchLiveBoardShifts: mocks.shifts }));
vi.mock("@/hooks/useRoundingOfflineSync", () => ({ useRoundingOfflineSync: () => ({ ready: mocks.ready, lastError: mocks.lastError, online: true, pendingCount: 0, isSyncing: false, flush: vi.fn() }) }));
vi.mock("@/components/caregiver/WorkingFacilitySelector", () => ({ WorkingFacilitySelector: () => null }));
vi.mock("@/components/rounding/RoundingOutbox", () => ({ RoundingOutbox: () => null }));
vi.mock("@/components/feedback/PilotFeedbackLauncher", () => ({ PilotFeedbackLauncher: () => null }));
import { CaregiverShell } from "./CaregiverShell";
beforeEach(() => {
  mocks.ready = false; mocks.lastError = null;
  mocks.shifts.mockResolvedValue([
    { shift_key: "early", label: "Early crew", starts_at_local: "04:30", ends_at_local: "16:30" },
    { shift_key: "late", label: "Late crew", starts_at_local: "16:30", ends_at_local: "04:30" },
  ]);
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
it.each([["2026-09-20T16:29:00-04:00", "Early crew shift"], ["2026-09-20T16:30:00-04:00", "Late crew shift"], ["2026-09-21T04:29:00-04:00", "Late crew shift"]])("uses the configured shift at %s", async (at, label) => {
  vi.setSystemTime(new Date(at)); render(<CaregiverShell>Content</CaregiverShell>);
  await screen.findByText(label); expect(mocks.shifts).toHaveBeenCalledWith(expect.anything(), "facility");
  expect(screen.queryByText(/evening shift/i)).toBeNull();
});
it("does not invent a shift when configuration fails and does not announce unverified sync", async () => {
  mocks.shifts.mockRejectedValue(new Error("unavailable"));
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  render(<CaregiverShell>Content</CaregiverShell>);
  await waitFor(() => expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Synthetic facility"));
  expect(screen.getByText("Checking sync…")).toBeTruthy();
  expect(screen.queryByText(/(Early crew|Late crew|Day|Evening|Night) shift/i)).toBeNull();
  log.mockRestore();
});

it("refreshes the label when the configured boundary passes without navigation", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-20T16:29:59-04:00"));
  await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
  expect(screen.getByText("Early crew shift")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
  expect(screen.getByText("Late crew shift")).toBeTruthy();
});

it("does not claim Synced after a failed Outbox snapshot", async () => {
 mocks.ready = true; mocks.lastError = "Outbox read unavailable";
 await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
 expect(screen.getByText("Sync unavailable")).toBeTruthy();
 expect(screen.queryByText("Synced")).toBeNull();
 await screen.findByRole("heading", { level: 1 });
});
