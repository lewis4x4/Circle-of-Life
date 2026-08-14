import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "./AppShell";

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/executive",
  useRouter: () => ({ push: pushMock, replace: vi.fn(), refresh: refreshMock }),
}));

vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "light", setTheme: vi.fn() }),
}));

vi.mock("next/dynamic", () => ({
  default: () => () => null,
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    email: "operator@example.com",
    appRole: "owner",
    user: { id: "user-1" },
    organizationId: "org-1",
    orgName: "Test Org",
    fullName: "Test Operator",
    avatarUrl: null,
    loading: false,
  }),
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

describe("AppShell all-sections menu", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Regression guard for Base UI error #31: DropdownMenuLabel (a base-ui
  // "group part") must sit inside a DropdownMenuGroup, or opening the menu
  // throws at runtime (dev tolerates it; production crashes the page).
  it("opens the all-sections menu on /admin/executive without crashing", async () => {
    const user = userEvent.setup();
    renderAppShell();

    const trigger = screen.getByRole("button", { name: /open all sections menu/i });
    await user.click(trigger);

    expect(trigger).toHaveAttribute("aria-expanded", "true");

    const menuPanels = Array.from(
      document.querySelectorAll('[data-slot="dropdown-menu-content"]'),
    ) as HTMLElement[];
    const allSectionsMenu = menuPanels.find(
      (panel) =>
        panel.textContent?.includes("Family Portal") &&
        panel.textContent?.includes("Ask knowledge base"),
    );
    expect(allSectionsMenu).toBeTruthy();
    expect(within(allSectionsMenu!).getByText("Executive")).toBeInTheDocument();
    expect(screen.getByText("Executive page content")).toBeInTheDocument();
  });
});
