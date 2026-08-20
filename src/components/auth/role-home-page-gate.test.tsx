import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RoleHomePageGate } from "./role-home-page-gate";

const authMock = vi.hoisted(() => ({
  loading: true,
  appRole: "",
}));

const replaceMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: replaceMock }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

describe("RoleHomePageGate", () => {
  it("shows a named checking gap while auth is loading", () => {
    authMock.loading = true;
    authMock.appRole = "owner";
    replaceMock.mockClear();

    render(
      <RoleHomePageGate
        expectedRoute="/admin/assistant-dashboard"
        homeAudienceLabel="administrative assistants"
      >
        <div>Assistant dashboard</div>
      </RoleHomePageGate>,
    );

    expect(screen.getByTestId("role-home-route-loading")).toBeInTheDocument();
    expect(screen.getByText("Checking your role home…")).toBeInTheDocument();
    expect(screen.queryByText("Assistant dashboard")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it("shows a named bounce and redirects owners away from the assistant home", () => {
    authMock.loading = false;
    authMock.appRole = "owner";
    replaceMock.mockClear();

    render(
      <RoleHomePageGate
        expectedRoute="/admin/assistant-dashboard"
        homeAudienceLabel="administrative assistants"
      >
        <div>Assistant dashboard</div>
      </RoleHomePageGate>,
    );

    expect(
      screen.getByText("This home is for administrative assistants — opening Owner home…"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Assistant dashboard")).not.toBeInTheDocument();
    expect(replaceMock).toHaveBeenCalledWith("/admin/executive");
  });

  it("renders the dashboard for the matching role", () => {
    authMock.loading = false;
    authMock.appRole = "admin_assistant";
    replaceMock.mockClear();

    render(
      <RoleHomePageGate
        expectedRoute="/admin/assistant-dashboard"
        homeAudienceLabel="administrative assistants"
      >
        <div>Assistant dashboard</div>
      </RoleHomePageGate>,
    );

    expect(screen.getByText("Assistant dashboard")).toBeInTheDocument();
    expect(screen.queryByTestId("role-home-route-loading")).not.toBeInTheDocument();
    expect(replaceMock).not.toHaveBeenCalled();
  });
});
