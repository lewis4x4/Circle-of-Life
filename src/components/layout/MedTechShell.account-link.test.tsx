import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  role: "med_tech",
  pathname: "/med-tech",
  linked: false as boolean | null,
  linkChecks: 0,
}));
vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user", app_metadata: { app_role: mocks.role } } } }) },
  }),
}));
vi.mock("@/lib/auth/account-link", () => ({
  hasLinkedStaffRecord: async () => {
    mocks.linkChecks += 1;
    return mocks.linked;
  },
  loadAccountLinkContact: async () => ({ facilityName: "Oakridge ALF", administratorName: null, phone: null }),
}));
vi.mock("@/lib/caregiver/facility-context", () => ({
  loadCaregiverFacilityContext: async () => ({ ok: true, ctx: { facilityId: "facility" } }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => ({ fullName: "Pat Tech" }) }));
vi.mock("@/components/feedback/PilotFeedbackLauncher", () => ({ PilotFeedbackLauncher: () => null }));

import { MedTechShell } from "./MedTechShell";

beforeEach(() => {
  mocks.role = "med_tech";
  mocks.pathname = "/med-tech";
  mocks.linked = false;
  mocks.linkChecks = 0;
});
afterEach(() => cleanup());

it("shows the shared not-set-up state instead of a cockpit that can never start", async () => {
  render(<MedTechShell>Cockpit</MedTechShell>);
  expect(await screen.findByText(/Your account isn.t set up yet/)).toBeInTheDocument();
  expect(screen.getByText(/Contact your administrator at Oakridge ALF/)).toBeInTheDocument();
  expect(screen.queryByText("Cockpit")).toBeNull();
});

it("keeps Required reading open for an unlinked med-tech", async () => {
  mocks.pathname = "/med-tech/acknowledgments";
  render(<MedTechShell>Reading list page</MedTechShell>);
  expect(await screen.findByText("Reading list page")).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByText(/Your account isn.t set up yet/)).toBeNull();
});

it("never runs the check for an admin visiting for oversight", async () => {
  mocks.role = "facility_admin";
  render(<MedTechShell>Cockpit</MedTechShell>);
  expect(await screen.findByText("Cockpit")).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(mocks.linkChecks).toBe(0);
});
