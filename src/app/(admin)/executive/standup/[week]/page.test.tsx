import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import ExecutiveStandupWeekDetailPage from "@/app/(admin)/executive/standup/[week]/page";

const authMock = vi.hoisted(() => ({
  loading: true,
  organizationId: null as string | null,
  user: null as { id: string } | null,
  appRole: "owner" as const,
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
    appRole: authMock.appRole,
    loading: authMock.loading,
  }),
}));

vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({}),
}));

vi.mock("@/lib/executive/standup", () => ({
  buildStandupBoardPrintHtml: vi.fn(),
  buildStandupPdfUrl: (weekOf: string) => `/api/executive/standup/${weekOf}/pdf`,
  buildStandupNarrative: vi.fn(),
  evaluateStandupPublishReadiness: vi.fn(() => ({ canPublish: false, blockers: ["Standup detail is unavailable."] })),
  STANDUP_SECTION_LABELS: {},
  fetchStandupSnapshotDetail: fetchStandupSnapshotDetailMock,
  fetchPreviousPublishedStandupSnapshotDetail: fetchPreviousPublishedStandupSnapshotDetailMock,
  publishStandupSnapshot: vi.fn(),
  saveStandupSnapshotNotes: vi.fn(),
  saveStandupMetricInput: vi.fn(),
  saveStandupBoardReport: vi.fn(),
  standupMetricDefinitionByKey: vi.fn(),
  summarizeStandupSections: vi.fn(() => []),
}));

vi.mock("../../executive-hub-nav", () => ({
  ExecutiveHubNav: () => <div data-testid="executive-hub-nav" />,
}));

describe("ExecutiveStandupWeekDetailPage auth hydration", () => {
  beforeEach(() => {
    fetchStandupSnapshotDetailMock.mockReset();
    fetchPreviousPublishedStandupSnapshotDetailMock.mockReset();
    fetchStandupSnapshotDetailMock.mockResolvedValue(null);
    fetchPreviousPublishedStandupSnapshotDetailMock.mockResolvedValue(null);
    authMock.loading = false;
    authMock.organizationId = null;
    authMock.user = null;
    authMock.appRole = "owner";
  });

  it("does not show the legacy org crash banner while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveStandupWeekDetailPage />);

    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
  });

  it("shows named loading copy while auth is hydrating", () => {
    authMock.loading = true;
    authMock.organizationId = null;

    render(<ExecutiveStandupWeekDetailPage />);

    expect(screen.getByText("Loading standup…")).toBeInTheDocument();
    expect(fetchStandupSnapshotDetailMock).not.toHaveBeenCalled();
  });

  it("shows the named quiet gap when auth resolved without an organization", async () => {
    authMock.loading = false;
    authMock.organizationId = null;

    render(<ExecutiveStandupWeekDetailPage />);

    expect(await screen.findByText("No organization on this profile")).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
    expect(fetchStandupSnapshotDetailMock).not.toHaveBeenCalled();
  });

  it("surfaces real fetch failures after auth resolves with retry", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchStandupSnapshotDetailMock.mockRejectedValue(new Error("Could not load standup detail."));

    render(<ExecutiveStandupWeekDetailPage />);

    expect(await screen.findByText("Could not load standup detail.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });

  it("does not show an org gap when standup week detail loads successfully", async () => {
    authMock.loading = false;
    authMock.organizationId = "org-anon-1";
    fetchStandupSnapshotDetailMock.mockResolvedValue({
      snapshot: {
        id: "snap-anon-1",
        weekOf: "2026-08-18",
        status: "draft",
        generatedAt: "2026-08-20T18:00:00.000Z",
        generatedById: null,
        generatedByName: null,
        publishedAt: null,
        publishedById: null,
        publishedByName: null,
        publishedVersion: 0,
        completenessPct: 42,
        confidenceBand: "medium",
        draftNotes: null,
        reviewNotes: null,
        pdfAttachmentPath: null,
      },
      facilities: [],
    });
    fetchPreviousPublishedStandupSnapshotDetailMock.mockResolvedValue(null);

    render(<ExecutiveStandupWeekDetailPage />);

    expect(await screen.findByText("Standup Week 2026-08-18")).toBeInTheDocument();
    expect(screen.queryByText("No organization on this profile")).not.toBeInTheDocument();
    expect(screen.queryByText("Organization missing on profile.")).not.toBeInTheDocument();
  });
});
