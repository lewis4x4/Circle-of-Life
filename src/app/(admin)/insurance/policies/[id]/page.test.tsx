import React from "react";
import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import Page from "./page";
import {
  draftFixture,
  policyId,
  workspaceFixture,
} from "@/components/insurance/test-support/fixtures";
const auth = vi.hoisted(() => ({
  loading: false,
  organizationId: "org",
  appRole: "facility_admin",
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
beforeEach(() => {
  auth.appRole = "facility_admin";
});
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (select: (s: { selectedFacilityId: null }) => unknown) =>
    select({ selectedFacilityId: null }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () =>
    "/admin/insurance/policies/44444444-4444-4444-8444-444444444444",
  useParams: () => ({ id: "44444444-4444-4444-8444-444444444444" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
it("shows the approved facility schedule without full-policy actions", async () => {
  const workspace = workspaceFixture();
  workspace.can_manage = false;
  workspace.policies = [
    {
      ...draftFixture().payload,
      id: policyId,
      verification_status: "verified",
      version: 1,
      status: "active",
    },
  ];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(workspace)));
  render(<Page />);
  expect(
    await screen.findByRole("heading", { name: "Approved facility summary" }),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Example ALF · scheduled location/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Stated premium")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Draft endorsement" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("heading", { name: "Approval and change history" }),
  ).not.toBeInTheDocument();
});
it("reports a missing scoped policy without exposing other records", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(
        Response.json({ ...workspaceFixture(), can_manage: false }),
      ),
  );
  render(<Page />);
  expect(
    await screen.findByText("Policy unavailable in your current access scope."),
  ).toBeInTheDocument();
});

it("preserves manager claim drill-ins and distinct premium allocations", async () => {
  auth.appRole = "owner";
  const workspace = workspaceFixture();
  workspace.policies = [
    {
      ...draftFixture().payload,
      id: policyId,
      verification_status: "verified",
      version: 1,
      status: "active",
    },
  ];
  workspace.claims = [
    {
      id: "claim-1",
      insurance_policy_id: policyId,
      claim_number: "CL-100",
      date_of_loss: "2026-09-03",
      status: "reported",
      paid_cents: 500000,
      reserve_cents: 100000,
    },
  ];
  workspace.premium_allocations = [
    {
      id: "allocation-1",
      insurance_policy_id: policyId,
      facility_id: "facility",
      allocation_method: "manual",
      allocated_premium_cents: 250000,
      period_start: "2026-09-01",
      period_end: "2026-09-30",
    },
  ];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(workspace)));
  render(<Page />);
  expect(
    await screen.findByRole("heading", { name: "Linked claims" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open claim · 2026-09-03" }),
  ).toHaveAttribute("href", "/admin/insurance/claims/claim-1");
  expect(screen.getByText(/manual · \$2,500.00/)).toBeInTheDocument();
  expect(
    screen.getByText(/Carrier loss figures remain separate/),
  ).toBeInTheDocument();
});

it("does not present a legacy false sharing placeholder as a verified finding", async () => {
  auth.appRole = "owner";
  const workspace = workspaceFixture();
  workspace.policies = [
    {
      ...draftFixture().payload,
      id: policyId,
      verification_status: "unverified",
      version: 0,
      status: "active",
      shared_limit: false,
    },
  ];
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(workspace)));
  render(<Page />);
  expect(await screen.findByText("Awaiting review")).toBeInTheDocument();
  expect(screen.queryByText("Not shared, as reviewed")).not.toBeInTheDocument();
});
