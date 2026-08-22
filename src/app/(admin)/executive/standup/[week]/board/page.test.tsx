import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveStandupBoardPage from "@/app/(admin)/executive/standup/[week]/board/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
}));

const fetchStandupSnapshotDetailMock = vi.hoisted(() => vi.fn());
const fetchPreviousPublishedStandupSnapshotDetailMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ week: "2026-08-18" }),
}));

vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    user: authMock.user,
    organizationId: authMock.organizationId,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/executive/standup", () => ({
  buildStandupBoardPrintHtml: vi.fn(),
  fetchStandupSnapshotDetail: fetchStandupSnapshotDetailMock,
  fetchPreviousPublishedStandupSnapshotDetail: fetchPreviousPublishedStandupSnapshotDetailMock,
  saveStandupBoardReport: vi.fn(),
}));

vi.mock("@/lib/executive/standup-packet", () => ({
  buildStandupPacketDocument: vi.fn(() => ({
    title: "Executive Standup Pack",
    subtitle: "Owner and board operating packet",
    focusStatement: "Portfolio focus",
    summaryCards: [],
    legend: [],
    methodology: [],
    narrative: {
      headline: "Headline",
      bullets: [],
      changes: [],
      dataQuality: [],
      actions: [],
      facilityActions: [],
    },
    sections: [],
    appendixSections: [],
    reviewNotes: null,
    draftNotes: null,
    comparison: null,
    spotlightFacility: null,
  })),
}));

describe("ExecutiveStandupBoardPage auth hydration", () => {
  beforeEach(() => {
    fetchStandupSnapshotDetailMock.mockReset();
    fetchPreviousPublishedStandupSnapshotDetailMock.mockReset();
    fetchStandupSnapshotDetailMock.mockResolvedValue(null);
    fetchPreviousPublishedStandupSnapshotDetailMock.mockResolvedValue(null);
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveStandupBoardPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveStandupBoardPage />);

    expect(screen.getByText("Loading standup board…")).toBeInTheDocument();
    expect(fetchStandupSnapshotDetailMock).not.toHaveBeenCalled();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveStandupBoardPage />);

    expect(await screen.findByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(fetchStandupSnapshotDetailMock).not.toHaveBeenCalled();
  });

  it("surfaces real fetch failures after auth resolves with retry", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchStandupSnapshotDetailMock.mockRejectedValue(new Error("Could not load board packet."));

    render(<ExecutiveStandupBoardPage />);

    expect(await screen.findByText("Could not load board packet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("shows stand-alone empty copy when no standup week exists", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";

    render(<ExecutiveStandupBoardPage />);

    expect(await screen.findByText("No standup board packet yet")).toBeInTheDocument();
    expect(screen.getByText(/Generate a draft from the standup pack page first/i)).toBeInTheDocument();
  });
});
