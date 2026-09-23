import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "med_tech",
  pathname: "/caregiver/rounds",
  linked: false as boolean | null,
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: mocks.role, loading: false, organizationId: "org", user: { id: "user", app_metadata: { app_role: mocks.role } } }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/lib/caregiver/facility-context", () => ({
  loadCaregiverFacilityContextForUser: async () => ({ ok: true, ctx: { facilityId: "facility", facilityName: "Oakridge ALF", timeZone: "America/New_York" } }),
}));
vi.mock("@/lib/auth/account-link", () => ({
  hasLinkedStaffRecord: async () => mocks.linked,
  loadAccountLinkContact: async () => ({ facilityName: "Oakridge ALF", administratorName: "Dana Admin", phone: "386-555-0100" }),
}));
vi.mock("@/lib/rounding/live-board-fetch", () => ({ fetchLiveBoardShifts: async () => [] }));
vi.mock("@/hooks/useRoundingOfflineSync", () => ({
  useRoundingOfflineSync: () => ({ ready: true, lastError: null, online: true, pendingCount: 0, isSyncing: false, flush: vi.fn() }),
}));
// Resolve the working facility immediately, as a single-facility login does.
vi.mock("@/components/caregiver/WorkingFacilitySelector", async () => {
  const { useEffect } = await import("react");
  return {
    WorkingFacilitySelector: ({ onResolved }: { onResolved: (id: string) => void }) => {
      useEffect(() => onResolved("facility"), [onResolved]);
      return null;
    },
  };
});
vi.mock("@/components/rounding/RoundingOutbox", () => ({ RoundingOutbox: () => null }));
vi.mock("@/components/feedback/PilotFeedbackLauncher", () => ({ PilotFeedbackLauncher: () => null }));

import { CaregiverShell } from "./CaregiverShell";

beforeEach(() => {
  mocks.role = "med_tech";
  mocks.pathname = "/caregiver/rounds";
  mocks.linked = false;
});
afterEach(() => cleanup());

it("shows one 'not set up yet' state instead of the page when a floor login has no staff record", async () => {
  render(<CaregiverShell>Rounds page</CaregiverShell>);
  expect(await screen.findByText(/Your account isn.t set up yet/)).toBeInTheDocument();
  expect(screen.getByText(/Contact Dana Admin at Oakridge ALF/)).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Call 386-555-0100" })).toHaveAttribute("href", "tel:386-555-0100");
  expect(screen.queryByText("Rounds page")).toBeNull();
});

it("applies to housekeepers too", async () => {
  mocks.role = "housekeeper";
  mocks.pathname = "/caregiver/clock";
  render(<CaregiverShell>Clock page</CaregiverShell>);
  expect(await screen.findByText(/Your account isn.t set up yet/)).toBeInTheDocument();
  expect(screen.queryByText("Clock page")).toBeNull();
});

it("keeps Required reading open while the login waits to be linked", async () => {
  mocks.pathname = "/caregiver/acknowledgments";
  render(<CaregiverShell>Required reading page</CaregiverShell>);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByText("Required reading page")).toBeInTheDocument();
  expect(screen.queryByText(/Your account isn.t set up yet/)).toBeNull();
});

it("renders the page for a linked login, and when the check could not run", async () => {
  mocks.linked = true;
  render(<CaregiverShell>Rounds page</CaregiverShell>);
  expect(await screen.findByText("Rounds page")).toBeInTheDocument();
  cleanup();
  mocks.linked = null;
  render(<CaregiverShell>Rounds page</CaregiverShell>);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByText("Rounds page")).toBeInTheDocument();
  expect(screen.queryByText(/Your account isn.t set up yet/)).toBeNull();
});
