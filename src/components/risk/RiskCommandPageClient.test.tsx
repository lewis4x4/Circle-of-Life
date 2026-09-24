import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/admin/risk",
}));

import RiskCommandPageClient from "./RiskCommandPageClient";

afterEach(cleanup);

describe("RiskCommandPageClient when the scorer has never run (COL-635)", () => {
  it("says scoring has not run and does not show a zero critical-facility count", () => {
    render(
      <RiskCommandPageClient
        initialData={{ facilities: [], latestRows: [], historyRows: [], recentDeliveries: [], openAlerts: [], smsSent24h: 0, scoreBands: null }}
        initialError={null}
        initialFacilityId={null}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(/Risk scoring has not run/);
    expect(screen.getByText("Not scored")).toBeTruthy();
    expect(screen.queryByText(/Run the nightly scorer once/)).toBeNull();
  });
});
