import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { T4Analytics } from "./T4Analytics";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: vi.fn() }),
  usePathname: () => "/admin/executive/standup",
  useSearchParams: () => new URLSearchParams(""),
}));

const audit = {
  auditHref: "/admin/audit",
  updatedAt: new Date("2026-04-24T12:00:00-04:00"),
  now: new Date("2026-04-24T12:05:00-04:00"),
};

describe("<T4Analytics />", () => {
  it("renders kpi strip, two charts, breakdown table, and audit footer", () => {
    render(
      <T4Analytics<{ id: string; value: number }>
        title="Standup"
        kpiStrip={[
          { label: "K1", value: 1 },
          { label: "K2", value: 2 },
        ]}
        charts={[
          <div key="c1" data-testid="chart-1">chart 1</div>,
          <div key="c2" data-testid="chart-2">chart 2</div>,
        ]}
        breakdownTable={{
          columns: [{ id: "id", header: "ID", accessor: (r) => r.id }],
          rows: [{ id: "a", data: { id: "a", value: 1 } }],
          userPreferencesKey: "test/t4",
          disablePreferences: true,
        }}
        audit={audit}
      />,
    );
    expect(screen.getByRole("region", { name: /kpi strip/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /charts/i })).toBeInTheDocument();
    expect(screen.getByTestId("chart-1")).toBeInTheDocument();
    expect(screen.getByTestId("chart-2")).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /breakdown table/i })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("supports a single chart configuration", () => {
    render(
      <T4Analytics<{ id: string }>
        title="Single chart"
        charts={[<div key="c" data-testid="only">only</div>]}
        breakdownTable={{
          columns: [{ id: "id", header: "ID", accessor: (r) => r.id }],
          rows: [],
          userPreferencesKey: "test/t4-single",
          disablePreferences: true,
        }}
        audit={audit}
      />,
    );
    expect(screen.getByTestId("only")).toBeInTheDocument();
  });
});
