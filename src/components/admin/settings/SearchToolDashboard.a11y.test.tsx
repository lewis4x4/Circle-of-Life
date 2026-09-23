import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({ appRole: "owner", organizationId: "org-1", loading: false }),
}));
vi.mock("@/hooks/useSearchToolPolicies", () => ({
  useSearchToolPolicies: () => ({
    policyMap: {},
    policies: [],
    loading: false,
    saving: false,
    error: null,
    togglePolicy: vi.fn(),
    seedDefaults: vi.fn(),
    reload: vi.fn(),
  }),
}));
vi.mock("@/hooks/useSearchAuditStream", () => ({
  useSearchAuditStream: () => ({
    entries: [],
    stats: { totalLoaded: 0, last5min: 0, last1hr: 0, toolCounts: {}, roleCounts: {}, avgDuration: 0 },
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

import { SearchToolDashboard } from "./SearchToolDashboard";

describe("SearchToolDashboard accessibility (COL-658)", () => {
  it("names every access toggle by tool and role, and every audit filter", () => {
    render(<SearchToolDashboard />);
    const switches = screen.getAllByRole("switch");
    expect(switches.length).toBeGreaterThan(0);
    for (const toggle of switches) {
      expect(toggle).toHaveAccessibleName(/.+ for .+/);
      expect(toggle).toHaveAttribute("aria-checked", "false");
    }
    expect(screen.getByRole("combobox", { name: "Filter audit by tool" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Filter audit by role" })).toBeInTheDocument();
  });
});
