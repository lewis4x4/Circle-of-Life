import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import AdminRoleRouteLoading from "./admin-role-route-loading";

const pathnameMock = vi.hoisted(() => ({ value: "/admin/staff" }));

vi.mock("next/navigation", () => ({
  usePathname: () => pathnameMock.value,
}));

describe("AdminRoleRouteLoading", () => {
  it("shows named role-home checking on assistant dashboard navigations", () => {
    pathnameMock.value = "/admin/assistant-dashboard";

    render(<AdminRoleRouteLoading />);

    expect(screen.getByTestId("role-home-route-loading")).toBeInTheDocument();
    expect(screen.getByText("Checking your role home…")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-route-loading")).not.toBeInTheDocument();
  });

  it("shows named role-home checking on coordinator dashboard navigations", () => {
    pathnameMock.value = "/admin/coordinator-dashboard";

    render(<AdminRoleRouteLoading />);

    expect(screen.getByText("Checking your role home…")).toBeInTheDocument();
    expect(screen.queryByTestId("admin-route-loading")).not.toBeInTheDocument();
  });

  it("keeps the admin skeleton for non role-home routes", () => {
    pathnameMock.value = "/admin/staff";

    render(<AdminRoleRouteLoading />);

    expect(screen.getByTestId("admin-route-loading")).toBeInTheDocument();
    expect(screen.queryByTestId("role-home-route-loading")).not.toBeInTheDocument();
  });
});
