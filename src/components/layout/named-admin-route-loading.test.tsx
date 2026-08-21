import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NamedAdminRouteLoading } from "./named-admin-route-loading";
import {
  ADMIN_BILLING_ROUTE_LOADING_MESSAGE,
  ADMIN_DIETARY_ROUTE_LOADING_MESSAGE,
  ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE,
  ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE,
  ADMIN_STAFFING_ROUTE_LOADING_MESSAGE,
} from "@/lib/admin/named-admin-route-loading-copy";

describe("NamedAdminRouteLoading", () => {
  it.each([
    ["staffing", ADMIN_STAFFING_ROUTE_LOADING_MESSAGE],
    ["dietary", ADMIN_DIETARY_ROUTE_LOADING_MESSAGE],
    ["billing", ADMIN_BILLING_ROUTE_LOADING_MESSAGE],
    ["facility overview", ADMIN_FACILITY_OVERVIEW_ROUTE_LOADING_MESSAGE],
    ["family notes", ADMIN_FAMILY_NOTES_ROUTE_LOADING_MESSAGE],
  ] as const)("shows named %s copy on first paint", (_surface, message) => {
    render(<NamedAdminRouteLoading message={message} />);

    expect(screen.getByTestId("role-home-route-loading")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(message);
    expect(screen.queryByTestId("admin-route-loading")).not.toBeInTheDocument();
  });
});
