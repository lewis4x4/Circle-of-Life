import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { FACILITY_SCOPE_LOCKED_REASON } from "@/lib/navigation/executive-facility-scope";
import { AdminShell } from "./AdminShell";

const authMock = vi.hoisted(() => ({
  email: "operator@example.com",
  appRole: "owner",
  user: { id: "user-1" },
  organizationId: "org-1",
  orgName: "Test Org",
  fullName: "Test Operator",
  avatarUrl: null as string | null,
  loading: false,
}));

const navMock = vi.hoisted(() => ({ pathname: "/admin" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navMock.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => authMock,
}));

vi.mock("@/hooks/useFacilityStore", () => {
  const state = {
    selectedFacilityId: null,
    availableFacilities: [{ id: "fac-1", name: "Homewood Lodge" }],
    facilitiesFetchedAt: Date.now(),
    facilitiesCacheUserId: "user-1",
    setSelectedFacility: vi.fn(),
    setAvailableFacilities: vi.fn(),
    clearFacilityCache: vi.fn(),
  };
  const useFacilityStore = Object.assign(
    (selector: (s: typeof state) => unknown) => selector(state),
    { getState: () => state },
  );
  return {
    FACILITY_LIST_TTL_MS: 60_000,
    useFacilityStore,
  };
});

vi.mock("@/hooks/useSurveyVisitSession", () => ({
  useSurveyVisitSession: () => ({
    active: false,
    loading: false,
    canManage: false,
    canLog: false,
    busy: false,
    logDescription: "",
    message: null,
    loadError: null,
    setLogDescription: vi.fn(),
    startSession: vi.fn(),
    endSession: vi.fn(),
    logAccess: vi.fn(),
  }),
}));

vi.mock("@/lib/admin-facilities", () => ({
  fetchAdminFacilityOptions: vi.fn().mockResolvedValue([{ id: "fac-1", name: "Homewood Lodge" }]),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({}) },
  }),
}));

vi.mock("@/components/layout/HavenShellBrandLink", () => ({
  HavenShellBrandLink: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children ?? "Haven"}</a>
  ),
}));

vi.mock("@/components/layout/UserMenu/UserMenu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock("@/components/compliance/SurveyVisitShellToggle", () => ({
  SurveyVisitShellToggle: () => null,
}));

vi.mock("@/components/feedback/PilotFeedbackLauncher", () => ({
  PilotFeedbackLauncher: () => null,
}));

function renderShellAt(pathname: string) {
  navMock.pathname = pathname;
  return render(
    <TooltipProvider>
      <AdminShell>
        <div>Page content</div>
      </AdminShell>
    </TooltipProvider>,
  );
}

function facilityTriggers() {
  return screen.getAllByTestId("admin-facility-filter-trigger");
}

describe("AdminShell facility scope on the executive overview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.loading = false;
    authMock.user = { id: "user-1" };
  });

  it("keeps the picker visible but disabled on exactly /admin/executive", () => {
    renderShellAt("/admin/executive");

    const triggers = facilityTriggers();
    expect(triggers.length).toBeGreaterThan(0);
    for (const trigger of triggers) {
      // Visible, not removed — an operator looking for the control still finds it.
      expect(trigger).toBeInTheDocument();
      expect(trigger).toBeDisabled();
      // Greyed, and the reason is readable rather than inferred from the styling.
      expect(trigger.className).toContain("disabled:opacity-60");
      expect(trigger.className).toContain("disabled:cursor-not-allowed");
      expect(trigger).toHaveAttribute("aria-label", FACILITY_SCOPE_LOCKED_REASON);
      expect(trigger).toHaveAttribute("title", FACILITY_SCOPE_LOCKED_REASON);
    }
  });

  it("still labels the current scope while disabled", () => {
    renderShellAt("/admin/executive");

    expect(facilityTriggers()[0]).toHaveTextContent("All facilities");
  });

  it.each([
    "/admin/executive/ceo",
    "/admin/executive/cfo",
    "/admin/executive/facility",
    "/admin/executive/entity/entity-1",
  ])("leaves the picker enabled on the child route %s", (pathname) => {
    renderShellAt(pathname);

    for (const trigger of facilityTriggers()) {
      expect(trigger).toBeEnabled();
      expect(trigger).toHaveAttribute("aria-label", "Facility filter — all facilities");
    }
  });

  it("leaves the picker enabled on unrelated admin routes", () => {
    renderShellAt("/admin");

    for (const trigger of facilityTriggers()) {
      expect(trigger).toBeEnabled();
    }
  });
});
