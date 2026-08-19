import React from "react";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "./AppShell";

const pushMock = vi.fn();
const refreshMock = vi.fn();

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

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/executive",
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("next/dynamic", () => ({
  default: (importFn: () => Promise<{ default: React.ComponentType<Record<string, unknown>> }>) => {
    const Lazy = React.lazy(importFn);
    return function DynamicComponent(props: Record<string, unknown>) {
      return (
        <React.Suspense fallback={null}>
          <Lazy {...props} />
        </React.Suspense>
      );
    };
  },
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => authMock,
}));

vi.mock("@/hooks/useFacilityStore", () => {
  const state = {
    selectedFacilityId: null,
    availableFacilities: [{ id: "fac-1", name: "Oakridge ALF" }],
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
  fetchAdminFacilityOptions: vi.fn().mockResolvedValue([{ id: "fac-1", name: "Oakridge ALF" }]),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({
    auth: { signOut: vi.fn().mockResolvedValue({}) },
  }),
}));

vi.mock("@/components/layout/LazyOverlayShells", () => ({
  LazyOverlayShells: () => null,
}));

vi.mock("@/components/layout/HavenShellBrandLink", () => ({
  HavenShellBrandLink: ({ children, ...props }: React.ComponentProps<"a">) => (
    <a {...props}>{children ?? "Haven"}</a>
  ),
}));

vi.mock("@/components/layout/UserMenu/UserMenu", () => ({
  UserMenu: () => <div data-testid="user-menu" />,
}));

vi.mock("@/components/layout/UserMenu/UserMenuSheet", () => ({
  UserMenuSheet: () => <div data-testid="user-menu-sheet" />,
}));

function renderAppShell() {
  return render(
    <TooltipProvider>
      <AppShell>
        <div>Executive page content</div>
      </AppShell>
    </TooltipProvider>,
  );
}

describe("AppShell all-sections jump list", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authMock.loading = false;
    authMock.appRole = "owner";
    authMock.user = { id: "user-1" };
  });

  it("does not render a mismatched role label in chrome while auth is loading", () => {
    authMock.loading = true;
    authMock.appRole = "facility_admin";

    renderAppShell();

    expect(screen.queryByText(/Facility Admin/i)).not.toBeInTheDocument();
  });

  it("opens on /admin/executive without crashing and shows common destinations", async () => {
    const user = userEvent.setup();
    renderAppShell();

    const trigger = screen.getByRole("button", { name: /open all sections menu/i });
    await user.click(trigger);

    await waitFor(() => {
      expect(screen.getByTestId("all-sections-jump-list")).toBeInTheDocument();
    });

    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const jumpList = screen.getByTestId("all-sections-jump-list");
    expect(within(jumpList).getByPlaceholderText("Search all sections…")).toHaveFocus();
    expect(within(jumpList).getByText("Executive")).toBeInTheDocument();
    expect(within(jumpList).getByText("Family notes")).toBeInTheDocument();
    expect(within(jumpList).getByText("Live rounding")).toBeInTheDocument();
    expect(within(jumpList).getByText("Snack pass")).toBeInTheDocument();
    expect(within(jumpList).queryByText("Ask knowledge base")).not.toBeInTheDocument();
    expect(within(jumpList).queryByText("Incident queue")).not.toBeInTheDocument();
    expect(screen.getByText("Executive page content")).toBeInTheDocument();
  });

  it("marks only the role-home alias active when it resolves to another nav destination", () => {
    renderAppShell();

    const ownerHomeLinks = screen.getAllByRole("link", { name: "Owner home" });
    const executiveLinks = screen.getAllByRole("link", { name: "Executive" });

    expect(ownerHomeLinks.some((link) => link.getAttribute("aria-current") === "page")).toBe(true);
    expect(executiveLinks.every((link) => link.getAttribute("aria-current") !== "page")).toBe(true);
  });

  it("closes when the trigger is clicked again", async () => {
    const user = userEvent.setup();
    renderAppShell();

    const trigger = screen.getByRole("button", { name: /open all sections menu/i });
    await user.click(trigger);

    await screen.findByTestId("all-sections-jump-list");
    expect(trigger).toHaveAttribute("aria-expanded", "true");

    await user.click(trigger);

    await waitFor(() => {
      expect(trigger).toHaveAttribute("aria-expanded", "false");
    });
  });

  it("filters the full section list as the operator types", async () => {
    const user = userEvent.setup();
    renderAppShell();

    await user.click(screen.getByRole("button", { name: /open all sections menu/i }));

    const jumpList = await screen.findByTestId("all-sections-jump-list");
    const search = within(jumpList).getByPlaceholderText("Search all sections…");

    await user.type(search, "billing");

    expect(within(jumpList).getByText("Billing & AR")).toBeInTheDocument();
    expect(within(jumpList).queryByText("Executive")).not.toBeInTheDocument();
    expect(within(jumpList).queryByText("Family notes")).not.toBeInTheDocument();
  });

  it("still surfaces non-common destinations when the operator searches", async () => {
    const user = userEvent.setup();
    renderAppShell();

    await user.click(screen.getByRole("button", { name: /open all sections menu/i }));

    const jumpList = await screen.findByTestId("all-sections-jump-list");
    const search = within(jumpList).getByPlaceholderText("Search all sections…");

    await user.type(search, "incident");

    expect(within(jumpList).getByText("Incident queue")).toBeInTheDocument();
    expect(within(jumpList).queryByText("Live rounding")).not.toBeInTheDocument();

    await user.clear(search);
    await user.type(search, "knowledge");

    expect(within(jumpList).getByText("Ask knowledge base")).toBeInTheDocument();
  });

  it("navigates when a filtered destination is chosen", async () => {
    const user = userEvent.setup();
    renderAppShell();

    await user.click(screen.getByRole("button", { name: /open all sections menu/i }));

    const jumpList = await screen.findByTestId("all-sections-jump-list");
    const search = within(jumpList).getByPlaceholderText("Search all sections…");
    await user.type(search, "clinical");

    await user.click(within(jumpList).getByRole("option", { name: /clinical desk/i }));

    expect(pushMock).toHaveBeenCalledWith("/admin/assessments/overdue");
  });
});
