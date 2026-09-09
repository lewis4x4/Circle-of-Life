import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import Page from "./page";
import {
  entityId,
  facilityId,
  workspaceFixture,
} from "@/components/insurance/test-support/fixtures";
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    loading: false,
    organizationId: "org",
    appRole: "facility_admin",
  }),
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (select: (s: { selectedFacilityId: null }) => unknown) =>
    select({ selectedFacilityId: null }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/insurance/coi",
  useParams: () => ({}),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
it("allows a facility certificate request but never offers issuance", async () => {
  const workspace = { ...workspaceFixture(), can_manage: false };
  const fetcher = vi
    .fn()
    .mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(
        Response.json(init?.method === "POST" ? { id: "request" } : workspace),
      ),
    );
  vi.stubGlobal("fetch", fetcher);
  render(<Page />);
  await screen.findByRole("button", { name: "Save certificate request" });
  fireEvent.change(screen.getByLabelText("Request facility"), {
    target: { value: facilityId },
  });
  fireEvent.change(screen.getByLabelText("Insured legal entity"), {
    target: { value: entityId },
  });
  fireEvent.change(screen.getByLabelText("Certificate holder name"), {
    target: { value: "Example landlord" },
  });
  fireEvent.change(
    screen.getByLabelText("Holder address and contact details"),
    { target: { value: "123 Main Street" } },
  );
  fireEvent.change(screen.getByLabelText("Certificate requirements"), {
    target: { value: "Proof of liability" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Save certificate request" }),
  );
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, init]) => init?.method === "POST")).toBe(
      true,
    ),
  );
  const body = JSON.parse(
    fetcher.mock.calls.find(([, init]) => init?.method === "POST")![1]!
      .body as string,
  );
  expect(body.action).toBe("create_certificate_request");
  expect(body.payload).toMatchObject({
    entity_id: entityId,
    facility_id: facilityId,
  });
  expect(body.payload).not.toHaveProperty("organization_id");
  expect(
    screen.queryByRole("button", { name: "Save certificate status" }),
  ).not.toBeInTheDocument();
});
