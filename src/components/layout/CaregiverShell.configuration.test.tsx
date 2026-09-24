import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ shifts: vi.fn(), ready: false, lastError: null as string | null, role: "med_tech", path: "/caregiver/rounds" }));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.path, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ appRole: mocks.role, fullName: "Pat Floor", loading: false, organizationId: "org", user: { id: "user", app_metadata: { app_role: mocks.role } } }) }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/caregiver/facility-context", () => ({ loadCaregiverFacilityContextForUser: async () => ({ ok: true, ctx: { facilityId: "facility", facilityName: "Synthetic facility", timeZone: "America/New_York" } }) }));
vi.mock("@/lib/schedules/assignment-context", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/schedules/assignment-context")>()), fetchUserAssignmentIntervals: mocks.shifts }));
vi.mock("@/lib/auth/account-link", () => ({ hasLinkedStaffRecord: async () => true, loadAccountLinkContact: async () => null }));
vi.mock("@/hooks/useRoundingOfflineSync", () => ({ useRoundingOfflineSync: () => ({ ready: mocks.ready, lastError: mocks.lastError, online: true, pendingCount: 0, isSyncing: false, flush: vi.fn() }) }));
vi.mock("@/components/caregiver/WorkingFacilitySelector", () => ({ WorkingFacilitySelector: () => null }));
vi.mock("@/components/rounding/RoundingOutbox", () => ({ RoundingOutbox: () => null }));
vi.mock("@/components/feedback/PilotFeedbackLauncher", () => ({ PilotFeedbackLauncher: () => null }));
import { CaregiverShell } from "./CaregiverShell";
beforeEach(() => {
  mocks.ready = false; mocks.lastError = null; mocks.role = "med_tech"; mocks.path = "/caregiver/rounds";
  mocks.shifts.mockResolvedValue([
    { assignment_id: "early", label: "Early crew", starts_at: "2026-09-20T08:30:00Z", ends_at: "2026-09-20T20:30:00Z" },
    { assignment_id: "late", label: "Late crew", starts_at: "2026-09-20T20:30:00Z", ends_at: "2026-09-21T08:30:00Z" },
  ]);
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.clearAllMocks(); });
it.each([["2026-09-20T16:29:00-04:00", "Early crew · scheduled"], ["2026-09-20T16:30:00-04:00", "Late crew · scheduled"], ["2026-09-21T04:29:00-04:00", "Late crew · scheduled"]])("uses the published work interval at %s", async (at, label) => {
  vi.setSystemTime(new Date(at)); render(<CaregiverShell>Content</CaregiverShell>);
  await screen.findByText(label); expect(mocks.shifts).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: "user", facilityId: "facility" }));
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
  expect(screen.getByText("Early crew · scheduled")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1001); });
  expect(screen.getByText("Late crew · scheduled")).toBeTruthy();
});

it("does not claim Synced after a failed Outbox snapshot", async () => {
 mocks.ready = true; mocks.lastError = "Outbox read unavailable";
 await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
 expect(screen.getByText("Sync unavailable")).toBeTruthy();
 expect(screen.queryByText("Synced")).toBeNull();
 await screen.findByRole("heading", { level: 1 });
});

it("gives a med-tech the one Med-Tech app's tabs, and a housekeeper only housekeeping tabs (COL-714)", async () => {
  await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
  const medTechTabs = screen.getByRole("navigation", { name: "Med-Tech navigation" });
  expect([...medTechTabs.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Meds", "Residents", "Rounds", "Clock", "Me"]);
  expect(screen.getAllByRole("link", { name: "Meds" })[0]).toHaveAttribute("href", "/med-tech");
  expect(screen.queryByRole("link", { name: "Med-Tech app" })).toBeNull();
  cleanup();
  mocks.role = "housekeeper";
  mocks.path = "/caregiver/housekeeper";
  await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
  const housekeeperTabs = screen.getByRole("navigation", { name: "Housekeeping navigation" });
  expect([...housekeeperTabs.querySelectorAll("a")].map((a) => a.textContent)).toEqual(["Home", "Clock", "Schedule", "Me"]);
  expect(screen.queryByRole("link", { name: "Meds" })).toBeNull();
});

it("shows the header's building, person and sign-out from the shared frame (COL-714)", async () => {
  await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
  const header = screen.getByRole("banner");
  expect(header).toHaveTextContent("Synthetic facility");
  expect(header).toHaveTextContent("Pat Floor");
  expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
});

it("lets the header scroll away on a phone so only the bottom tab bar stays (COL-657)", async () => {
  await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
  const header = screen.getByRole("banner");
  expect(header.className).toContain("md:sticky");
  expect(header.className).not.toMatch(/(^|\s)sticky(\s|$)/);
});

it("lights only Meds on /caregiver/meds — Me matches its own segment, not a prefix (COL-655)", async () => {
  mocks.path = "/caregiver/meds";
  await act(async () => { render(<CaregiverShell>Content</CaregiverShell>); });
  const lit = [...new Set(screen.getAllByRole("link").filter((link) => link.getAttribute("aria-current") === "page").map((link) => link.textContent?.trim()))];
  expect(lit).toEqual(["Meds"]);
});
