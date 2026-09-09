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
  appRole: "owner",
}));
vi.mock("@/contexts/haven-auth-context", () => ({ useHavenAuth: () => auth }));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (select: (s: { selectedFacilityId: null }) => unknown) =>
    select({ selectedFacilityId: null }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/insurance/policies",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
beforeEach(() => {
  auth.appRole = "owner";
  vi.stubGlobal("fetch", vi.fn());
});
it("labels legacy policies unverified and offers a review retaining identity", async () => {
  const workspace = workspaceFixture();
  workspace.policies = [
    {
      ...draftFixture().payload,
      id: policyId,
      verification_status: "unverified",
      version: 0,
      status: "active",
      premium_cents: 9000000,
    },
  ];
  vi.mocked(fetch).mockResolvedValue(Response.json(workspace));
  render(<Page />);
  expect(
    await screen.findByText("Unverified legacy record"),
  ).toBeInTheDocument();
  expect(screen.queryByText("$90,000.00")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Verify existing policy" }),
  ).toHaveAttribute(
    "href",
    `/admin/insurance/policies/new?kind=verification&policy_id=${policyId}`,
  );
});
it("renders minimal facility summaries without premium columns", async () => {
  auth.appRole = "facility_admin";
  const workspace = workspaceFixture();
  workspace.can_manage = false;
  workspace.policies = [
    {
      id: policyId,
      policy_type: "general_liability",
      carrier_name: "Example carrier",
      policy_number: "GL-123",
      effective_date: "2026-09-01",
      expiration_date: "2027-09-01",
      verification_status: "verified",
      status: "active",
      version: 1,
    },
  ];
  vi.mocked(fetch).mockResolvedValue(Response.json(workspace));
  render(<Page />);
  await screen.findByRole("link", { name: "GL-123" });
  expect(
    screen.queryByRole("columnheader", { name: "Premium" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Verify existing policy" }),
  ).not.toBeInTheDocument();
});
