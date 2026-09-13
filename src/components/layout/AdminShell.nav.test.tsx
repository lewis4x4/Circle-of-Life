import React from "react";
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminShell } from "./AdminShell";

const authMock = vi.hoisted(() => ({
  email: "operator@example.com",
  appRole: "facility_admin",
  user: { id: "user-1" },
  organizationId: "org-1",
  orgName: "Test Org",
  fullName: "Test Operator",
  avatarUrl: null as string | null,
  loading: false,
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin",
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

const SITE_WORK_HREF = "/admin/operations/work";
const SITE_WORK_LABEL = "Site work";

function renderShellForRole(appRole: string) {
  authMock.appRole = appRole;
  return render(
    <TooltipProvider>
      <AdminShell>
        <div>Page content</div>
      </AdminShell>
    </TooltipProvider>,
  );
}

function primaryNav() {
  // The desktop sidebar nav is always in the DOM; the mobile drawer only mounts when opened.
  return screen.getByRole("navigation", { name: "Primary" });
}

function siteWorkLinks() {
  return within(primaryNav()).queryAllByRole("link", { name: SITE_WORK_LABEL });
}

describe("AdminShell Site work navigation (COL-148 / HFO-10)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.loading = false;
    authMock.user = { id: "user-1" };
  });

  it("shows Site work in the Command group for facility_admin (no allowlist)", () => {
    renderShellForRole("facility_admin");

    const links = siteWorkLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", SITE_WORK_HREF);

    const commandHeader = within(primaryNav()).getByRole("button", { name: "Command" });
    const commandSection = commandHeader.parentElement as HTMLElement;
    expect(within(commandSection).getByRole("link", { name: SITE_WORK_LABEL })).toBe(links[0]);
  });

  it("shows Site work for admin_assistant through the visibleItemKeys allowlist", () => {
    renderShellForRole("admin_assistant");

    const links = siteWorkLinks();
    expect(links).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", SITE_WORK_HREF);

    // The assistant's role home is still injected ahead of the allowlisted items.
    expect(within(primaryNav()).getByRole("link", { name: "Front desk home" })).toHaveAttribute(
      "href",
      "/admin/assistant-dashboard",
    );
  });

  it("hides Site work for coordinator, whose allowlist excludes it", () => {
    renderShellForRole("coordinator");

    expect(siteWorkLinks()).toHaveLength(0);
    // Sanity: the coordinator nav rendered other allowlisted items, so the absence is a filter result.
    expect(within(primaryNav()).getByRole("link", { name: "Resident roster" })).toBeInTheDocument();
  });

  it("hides Site work for nurse, whose allowlist excludes it", () => {
    renderShellForRole("nurse");

    expect(siteWorkLinks()).toHaveLength(0);
    expect(within(primaryNav()).getByRole("link", { name: "Incident queue" })).toBeInTheDocument();
  });
});
