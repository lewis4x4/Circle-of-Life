import { describe, expect, it } from "vitest";

import {
  ADMIN_BILLING_ROUTE_LOADING_MESSAGE,
  ADMIN_DIETARY_ROUTE_LOADING_MESSAGE,
  ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE,
  ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE,
  ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE,
  ADMIN_ROUNDING_ROUTE_LOADING_MESSAGE,
  ADMIN_STAFFING_ROUTE_LOADING_MESSAGE,
} from "./named-admin-route-loading-copy";

describe("named admin route loading copy", () => {
  it("uses calm Quiet Operator messages for flagship admin surfaces", () => {
    expect(ADMIN_STAFFING_ROUTE_LOADING_MESSAGE).toBe("Loading staffing…");
    expect(ADMIN_DIETARY_ROUTE_LOADING_MESSAGE).toBe("Loading dietary…");
    expect(ADMIN_BILLING_ROUTE_LOADING_MESSAGE).toBe("Loading billing…");
    expect(ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE).toBe("Loading facility overview…");
    expect(ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE).toBe("Loading family notes…");
    expect(ADMIN_RESIDENTS_ROUTE_LOADING_MESSAGE).toBe("Loading residents…");
    expect(ADMIN_ROUNDING_ROUTE_LOADING_MESSAGE).toBe("Loading rounding…");
  });
});
