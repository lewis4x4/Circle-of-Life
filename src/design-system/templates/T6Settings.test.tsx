import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { T6Settings } from "./T6Settings";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/settings",
  useSearchParams: () => new URLSearchParams(""),
}));

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

describe("<T6Settings />", () => {
  it("renders sub-nav, sections, save state, and audit footer", () => {
    render(
      <T6Settings
        title="Settings"
        subnav={[
          { id: "users", label: "Users & Roles", href: "/admin/settings/users", active: true },
          { id: "thresholds", label: "Thresholds", href: "/admin/settings/thresholds" },
        ]}
        sections={[
          {
            id: "general",
            label: "General",
            description: "Org-wide defaults",
            body: <p>section body</p>,
          },
        ]}
        saveState="dirty"
        audit={audit}
      />,
    );

    expect(screen.getByRole("navigation", { name: /settings sub-nav/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /users & roles/i })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("region", { name: /general/i })).toBeInTheDocument();
    // Two status elements coexist: the AuditFooter Live dot and the T6
    // save-state badge. Find the one matching the expected copy.
    const statusBadges = screen.getAllByRole("status");
    expect(statusBadges.some((n) => /unsaved changes/i.test(n.textContent ?? ""))).toBe(true);
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("renders without sub-nav when omitted", () => {
    render(
      <T6Settings
        title="Settings"
        sections={[{ id: "x", label: "X", body: <p>body</p> }]}
        audit={audit}
      />,
    );
    expect(screen.queryByRole("navigation", { name: /settings sub-nav/i })).toBeNull();
  });
});
