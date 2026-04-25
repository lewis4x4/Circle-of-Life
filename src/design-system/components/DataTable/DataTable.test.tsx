import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DataTable } from "./DataTable";
import type { DataTableColumn, DataTableRow } from "./columns";

type Facility = {
  id: string;
  name: string;
  occupancyPct: number;
  laborCostPct: number;
};

const COLUMNS: DataTableColumn<Facility>[] = [
  {
    id: "name",
    header: "Facility",
    accessor: (row) => row.name,
    align: "left",
    sticky: true,
  },
  {
    id: "occupancyPct",
    header: "Occupancy %",
    accessor: (row) => row.occupancyPct,
    align: "right",
    numeric: true,
    metricKey: "occupancy_pct",
  },
  {
    id: "laborCostPct",
    header: "Labor cost %",
    accessor: (row) => row.laborCostPct,
    align: "right",
    numeric: true,
    metricKey: "labor_cost_pct",
  },
];

function buildRows(): DataTableRow<Facility>[] {
  return [
    {
      id: "oakridge",
      data: { id: "oakridge", name: "Oakridge ALF", occupancyPct: 92, laborCostPct: 32 },
    },
    {
      id: "homewood",
      data: { id: "homewood", name: "Homewood Lodge", occupancyPct: 70, laborCostPct: 41 },
      status: "warning",
      statusTooltip: "Labor cost above target",
    },
    {
      id: "plantation",
      data: { id: "plantation", name: "Plantation", occupancyPct: 99, laborCostPct: 28 },
    },
  ];
}

describe("<DataTable />", () => {
  beforeEach(() => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          dashboardId: "test",
          columnOrder: [],
          columnVisibility: {},
          savedViews: [],
          exists: false,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    ) as typeof globalThis.fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("renders headers, rows, and the implicit status column", () => {
    render(
      <DataTable<Facility>
        columns={COLUMNS}
        rows={buildRows()}
        userPreferencesKey="test/facilities"
        disablePreferences
        thresholds={{
          occupancy_pct: { target: 90, direction: "up", warningBandPct: 10 },
          labor_cost_pct: { target: 35, direction: "down", warningBandPct: 10 },
        }}
      />,
    );

    expect(screen.getByRole("columnheader", { name: /facility/i })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /occupancy %/i })).toBeInTheDocument();
    expect(screen.getByText("Oakridge ALF")).toBeInTheDocument();
    expect(screen.getAllByLabelText(/row status: ok/i).length).toBeGreaterThan(0);
    expect(screen.getByLabelText(/labor cost above target/i)).toBeInTheDocument();
  });

  it("applies threshold tone classes to numeric cells", () => {
    render(
      <DataTable<Facility>
        columns={COLUMNS}
        rows={buildRows()}
        userPreferencesKey="test/facilities"
        disablePreferences
        thresholds={{
          occupancy_pct: { target: 90, direction: "up", warningBandPct: 10 },
          labor_cost_pct: { target: 35, direction: "down", warningBandPct: 10 },
        }}
      />,
    );

    const homewoodRow = screen.getByText("Homewood Lodge").closest("tr")!;
    const cells = within(homewoodRow).getAllByRole("cell");
    // Occupancy 70 vs target 90 (up direction, 10% band) → critical
    expect(cells.find((c) => c.textContent === "70")?.className).toMatch(/text-danger/);
    // Labor 41 vs target 35 (down direction, 10% band → 35-38.5 warning) → critical
    expect(cells.find((c) => c.textContent === "41")?.className).toMatch(/text-danger/);
  });

  it("renders an empty state when rows is empty", () => {
    render(
      <DataTable<Facility>
        columns={COLUMNS}
        rows={[]}
        userPreferencesKey="test/empty"
        disablePreferences
        emptyState="No facilities in scope."
      />,
    );
    expect(screen.getByText(/no facilities in scope/i)).toBeInTheDocument();
  });

  it("renders skeleton rows when loading", () => {
    const { container } = render(
      <DataTable<Facility>
        columns={COLUMNS}
        rows={[]}
        userPreferencesKey="test/loading"
        disablePreferences
        loading
      />,
    );
    // Skeleton rows are aria-hidden, so query the DOM directly.
    const skeletonRows = container.querySelectorAll('tbody tr[aria-hidden="true"]');
    expect(skeletonRows.length).toBe(3);
  });

  it("invokes row open-in-panel and open-in-new-tab callbacks", async () => {
    const user = userEvent.setup();
    const onPanel = vi.fn();
    const onNewTab = vi.fn();
    render(
      <DataTable<Facility>
        columns={COLUMNS}
        rows={buildRows()}
        userPreferencesKey="test/actions"
        disablePreferences
        onRowOpenPanel={onPanel}
        onRowOpenNewTab={onNewTab}
      />,
    );

    await user.click(screen.getByRole("button", { name: /open row oakridge in panel/i }));
    await user.click(screen.getByRole("button", { name: /open row homewood in new tab/i }));
    expect(onPanel).toHaveBeenCalledWith("oakridge", expect.objectContaining({ id: "oakridge" }));
    expect(onNewTab).toHaveBeenCalledWith("homewood", expect.objectContaining({ id: "homewood" }));
  });

  it("Customize toggles column visibility", async () => {
    const user = userEvent.setup();
    render(
      <DataTable<Facility>
        columns={COLUMNS}
        rows={buildRows()}
        userPreferencesKey="test/customize"
        disablePreferences
      />,
    );

    expect(screen.getByRole("columnheader", { name: /labor cost %/i })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^customize$/i }));
    const dialog = await screen.findByRole("dialog", { name: /customize columns/i });
    const checkbox = within(dialog)
      .getAllByRole("checkbox")
      .find((c) => c.parentElement?.textContent?.includes("Labor cost %"));
    expect(checkbox).toBeDefined();
    await user.click(checkbox!);

    await waitFor(() => {
      expect(screen.queryByRole("columnheader", { name: /labor cost %/i })).toBeNull();
    });
  });

  it("Export menu offers CSV/XLSX/PDF and triggers callback for CSV", async () => {
    const user = userEvent.setup();
    const onExport = vi.fn(async () => undefined);
    render(
      <DataTable<Facility>
        columns={COLUMNS}
        rows={buildRows()}
        userPreferencesKey="test/export"
        disablePreferences
        onExport={onExport}
      />,
    );

    await user.click(screen.getByRole("button", { name: /^export$/i }));
    const menu = await screen.findByRole("menu", { name: /export format/i });
    expect(within(menu).getByRole("menuitem", { name: /export csv/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /export xlsx/i })).toBeInTheDocument();
    expect(within(menu).getByRole("menuitem", { name: /export pdf/i })).toBeInTheDocument();

    await user.click(within(menu).getByRole("menuitem", { name: /export csv/i }));
    expect(onExport).toHaveBeenCalledWith("csv");
  });
});
