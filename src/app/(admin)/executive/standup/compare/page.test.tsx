import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveStandupComparePage from "@/app/(admin)/executive/standup/compare/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
}));

const fetchStandupHistoryMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/executive/standup", () => ({
  buildStandupComparison: vi.fn(),
  fetchStandupHistory: fetchStandupHistoryMock,
  fetchStandupSnapshotDetail: vi.fn(),
  STANDUP_SECTION_LABELS: {},
}));

vi.mock("../../executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

describe("ExecutiveStandupComparePage auth hydration", () => {
  beforeEach(() => {
    fetchStandupHistoryMock.mockReset();
    fetchStandupHistoryMock.mockResolvedValue([]);
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveStandupComparePage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveStandupComparePage />);

    expect(await screen.findByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(fetchStandupHistoryMock).not.toHaveBeenCalled();
  });

  it("surfaces real fetch failures after auth resolves", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchStandupHistoryMock.mockRejectedValue(new Error("Could not load standup comparison."));

    render(<ExecutiveStandupComparePage />);

    expect(await screen.findByText("Could not load standup comparison.")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
