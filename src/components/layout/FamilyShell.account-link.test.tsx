import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ linked: false as boolean | null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/family/billing", useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: {
      getSession: async () => ({ data: { session: { user: { id: "family-user", email: "family@example.test", user_metadata: { full_name: "Robin Family" } } } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
    },
  }),
}));
vi.mock("@/lib/auth/account-link", () => ({ hasLinkedResident: async () => mocks.linked }));
vi.mock("@/lib/family/family-building", () => ({ loadFamilyBuildingName: async () => "Homewood Lodge, ALF" }));
vi.mock("@/components/feedback/PilotFeedbackLauncher", () => ({ PilotFeedbackLauncher: () => null }));

import { FamilyShell } from "./FamilyShell";

beforeEach(() => {
  mocks.linked = false;
});
afterEach(() => cleanup());

it("shows the shared not-set-up state, not '$0.00 · In good standing', and hides the other tabs", async () => {
  render(<FamilyShell>$0.00 · In good standing</FamilyShell>);
  expect(await screen.findByText(/Your account isn.t set up yet/)).toBeInTheDocument();
  expect(screen.getByText(/isn.t linked to a resident yet/)).toBeInTheDocument();
  expect(screen.getByText(/Contact the facility office/)).toBeInTheDocument();
  expect(screen.queryByText(/In good standing/)).toBeNull();
  expect(screen.queryByRole("navigation", { name: "Family navigation" })).toBeNull();
});

it("renders the portal for a linked family member, and when the check could not run", async () => {
  mocks.linked = true;
  render(<FamilyShell>Billing page</FamilyShell>);
  expect(await screen.findByText("Billing page")).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Family navigation" })).toBeInTheDocument();
  cleanup();
  mocks.linked = null;
  render(<FamilyShell>Billing page</FamilyShell>);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.getByText("Billing page")).toBeInTheDocument();
});

it("uses the shared header: the loved one's building, the person's name (never the email), Sign out (COL-714)", async () => {
  mocks.linked = true;
  render(<FamilyShell>Billing page</FamilyShell>);
  const header = screen.getByRole("banner");
  expect(await within(header).findByText("Homewood Lodge, ALF")).toBeInTheDocument();
  expect(within(header).getByText("Robin Family")).toBeInTheDocument();
  expect(within(header).queryByText("family@example.test")).toBeNull();
  expect(within(header).getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  const tabs = screen.getByRole("navigation", { name: "Family navigation" });
  expect(within(tabs).getByRole("link", { name: "Billing" })).toHaveAttribute("aria-current", "page");
});
