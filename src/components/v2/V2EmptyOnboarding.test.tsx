import { existsSync } from "node:fs";
import { join } from "node:path";

import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

import { V2_DASHBOARD_IDS } from "@/lib/v2-dashboards";

import { V2EmptyOnboarding } from "./V2EmptyOnboarding";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

const ADMIN_APP_ROOT = join(process.cwd(), "src/app/(admin)/admin");

function adminRoutePagePath(href: string): string {
  const relative = href.replace(/^\/admin\/?/, "");
  return join(ADMIN_APP_ROOT, relative, "page.tsx");
}

const TWO_WAY_FAMILY_MARKERS = [
  "family-message backlog",
  "family message backlog",
  "unread family messages",
  "chat inbox",
  "needs response",
  "reply to family",
  "two-way chat",
];

describe("V2EmptyOnboarding", () => {
  it.each(V2_DASHBOARD_IDS)("uses real /admin routes without a double-admin prefix for %s", (dashboardId) => {
    render(<V2EmptyOnboarding dashboardId={dashboardId} facilityCount={2} />);

    const hrefs = screen.getAllByRole("link").map((link) => link.getAttribute("href") ?? "");

    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href, `double-admin href ${href}`).not.toMatch(/\/admin\/admin\//);
      expect(href, `missing /admin prefix on ${href}`).toMatch(/^\/admin\//);
      expect(existsSync(adminRoutePagePath(href)), `no App Router page for ${href}`).toBe(true);
    }
  });

  it("does not describe family-message backlog on the command-center step", () => {
    render(<V2EmptyOnboarding dashboardId="command-center" facilityCount={1} />);

    const text = screen.getByRole("list").textContent?.toLowerCase() ?? "";

    for (const marker of TWO_WAY_FAMILY_MARKERS) {
      expect(text, `command-center still mentions ${marker}`).not.toContain(marker);
    }

    expect(text).toMatch(/family bulletin/);
  });

  it("names the Quiet Operator gap state when facilities are in scope", () => {
    render(<V2EmptyOnboarding dashboardId="command-center" facilityCount={3} />);

    expect(screen.getByText(/No value posted/)).toBeInTheDocument();
    expect(screen.getByText(/not silent blanks/i)).toBeInTheDocument();
  });
});
