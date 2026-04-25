import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { T2List } from "./T2List";

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

describe("<T2List />", () => {
  it("renders title, table region, and audit footer", () => {
    render(
      <T2List<{ id: string; name: string }>
        title="Residents"
        audit={audit}
        table={{
          columns: [{ id: "name", header: "Name", accessor: (r) => r.name }],
          rows: [{ id: "a", data: { id: "a", name: "Alpha" } }],
          userPreferencesKey: "test/t2",
          disablePreferences: true,
        }}
      />,
    );
    expect(screen.getByRole("heading", { level: 1, name: /residents/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /queue table/i })).toBeInTheDocument();
    expect(screen.getByRole("contentinfo", { name: /audit/i })).toBeInTheDocument();
  });

  it("renders the optional side-panel as right rail", () => {
    render(
      <T2List<{ id: string }>
        title="Residents"
        audit={audit}
        table={{
          columns: [{ id: "id", header: "ID", accessor: (r) => r.id }],
          rows: [],
          userPreferencesKey: "test/t2-side",
          disablePreferences: true,
        }}
        sidePanel={<aside data-testid="detail">Detail</aside>}
      />,
    );
    expect(screen.getByRole("complementary", { name: /right rail/i })).toBeInTheDocument();
    expect(screen.getByTestId("detail")).toBeInTheDocument();
  });
});
