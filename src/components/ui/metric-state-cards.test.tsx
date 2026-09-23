import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { KPITile } from "@/design-system/components/KPITile";
import { metricFromCount, metricNeedsFacility, metricNoData, metricValue } from "@/lib/metrics/metric-state";

import { KpiCard } from "./kpi-card";
import { MetricCard } from "./metric-card";
import { StatCard } from "./stat-card";

describe("KPI cards with a MetricState (COL-649)", () => {
  it("StatCard shows Unavailable, not 0, and drops attention chrome when the read failed", () => {
    const { container } = render(
      <StatCard label="Open claims" state={metricFromCount({ count: null, error: new Error("400") })} attentionTone="danger" />,
    );
    expect(screen.getByText("Unavailable")).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
    const card = container.firstElementChild as HTMLElement;
    expect(card.dataset.attention).toBe("false");
    expect(card.dataset.metricState).toBe("unavailable");
  });

  it("StatCard still renders and colours a real value", () => {
    const { container } = render(<StatCard label="Open claims" state={metricValue(3)} attentionTone="danger" />);
    expect(screen.getByText("3")).toBeTruthy();
    expect((container.firstElementChild as HTMLElement).dataset.attention).toBe("true");
  });

  it("KpiCard names the missing facility and ignores tone", () => {
    render(<KpiCard label="Active diet orders" state={metricNeedsFacility()} tone="success" />);
    const value = screen.getByText("Select a facility");
    expect(value.className).not.toMatch(/emerald|success/);
  });

  it("MetricCard with thresholds does not turn a no-data rate green or red", () => {
    render(<MetricCard label="Completion" state={metricNoData("No tasks")} thresholds={{ type: "rate-percent" }} />);
    const value = screen.getByText("No tasks");
    expect(value.className).not.toMatch(/success|destructive|warning/);
  });

  it("KPITile renders the placeholder without tone, unit or breach", () => {
    const { container } = render(
      <KPITile
        label="Occupancy"
        state={metricNoData("No census loaded")}
        unit="%"
        tone="danger"
        breachMessage="Below target"
        info="Occupied beds over licensed beds"
      />,
    );
    expect(screen.getByText("No census loaded")).toBeTruthy();
    expect(screen.queryByText("%")).toBeNull();
    expect(screen.queryByText("Below target")).toBeNull();
    expect((container.firstElementChild as HTMLElement).dataset.tone).toBe("default");
  });
});
