import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { T1Dashboard, type T1DashboardProps } from "./T1Dashboard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin",
  useSearchParams: () => new URLSearchParams(""),
}));

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

function buildProps(): T1DashboardProps<{ id: string; name: string }> {
  return {
    title: "Triage Inbox",
    subtitle: "Portfolio summary",
    scope: { owners: [], groups: [], facilities: [] },
    audit,
    kpis: [
      { label: "K1", value: 1 },
      { label: "K2", value: 2 },
      { label: "K3", value: 3 },
      { label: "K4", value: 4 },
      { label: "K5", value: 5 },
      { label: "K6", value: 6 },
    ],
    panels: [
      { title: "P1", children: <span>p1 body</span> },
      { title: "P2", children: <span>p2 body</span> },
      { title: "P3", children: <span>p3 body</span> },
      { title: "P4", children: <span>p4 body</span> },
    ],
    table: {
      columns: [{ id: "name", header: "Name", accessor: (r) => r.name }],
      rows: [{ id: "a", data: { id: "a", name: "Alpha" } }],
      userPreferencesKey: "test/t1",
      disablePreferences: true,
    },
    alerts: [],
    actionQueue: [],
  };
}

describe("<T1Dashboard />", () => {
  it("renders all required regions", () => {
    render(<T1Dashboard {...buildProps()} />);
    expect(screen.getByRole("heading", { level: 1, name: /triage inbox/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /kpi strip/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /panel grid/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /primary table/i })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("renders exactly 6 KPI tiles", () => {
    render(<T1Dashboard {...buildProps()} />);
    const strip = screen.getByRole("region", { name: /kpi strip/i });
    const tiles = strip.querySelectorAll('[data-tone]');
    expect(tiles).toHaveLength(6);
  });

  it("renders the right rail with priority alerts and action queue panels", () => {
    render(<T1Dashboard {...buildProps()} />);
    const aside = screen.getByRole("complementary", { name: /right rail/i });
    expect(aside).toHaveTextContent(/priority alerts/i);
    expect(aside).toHaveTextContent(/action queue/i);
  });
});
