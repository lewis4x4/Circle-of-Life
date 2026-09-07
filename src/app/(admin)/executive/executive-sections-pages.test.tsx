import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import OverviewPage from "@/app/(admin)/admin/executive/page";
import AlertsPage from "@/app/(admin)/admin/executive/alerts/page";

const mocks = vi.hoisted(() => ({ pathname: "/admin/executive" }));

vi.mock("next/navigation", () => ({
  usePathname: () => mocks.pathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: "owner", loading: false, organizationId: null, user: null }),
}));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));
vi.mock("@/hooks/useFacilityStore", () => ({ useFacilityStore: () => ({ selectedFacilityId: null }) }));

describe("Executive page mobile Sections integration", () => {
  it.each([
    ["/admin/executive", "Overview", OverviewPage],
    ["/admin/executive/alerts", "Alerts", AlertsPage],
  ] as const)("mounts usable Sections navigation on the canonical %s page", async (pathname, label, Page) => {
    mocks.pathname = pathname;
    render(<Page />);
    const trigger = screen.getByRole("button", { name: "Open executive intelligence sections" });
    // happy-dom does not evaluate Tailwind media queries: check ancestors too,
    // so the original hidden-on-mobile page wrapper cannot regress silently.
    for (let node: HTMLElement | null = trigger; node; node = node.parentElement) {
      expect(node).not.toHaveClass("hidden");
    }
    fireEvent.click(trigger);
    const drawer = within(await screen.findByRole("dialog", { name: "Executive intelligence" }));
    expect(drawer.getAllByRole("link", { current: "page" })).toHaveLength(1);
    expect(drawer.getByRole("link", { current: "page" })).toHaveAccessibleName(label);
    expect(drawer.getByRole("link", { name: "Standup history" })).toHaveAttribute("href", "/admin/executive/standup/history");
  });
});
