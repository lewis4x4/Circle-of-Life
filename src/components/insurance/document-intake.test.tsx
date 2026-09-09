// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import React from "react";
import userEvent from "@testing-library/user-event";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { UploadInsuranceDocument } from "./workspace-client";
import { InsuranceDocumentPage } from "./workspace-pages";
import {
  documentFixture,
  documentId,
  workspaceFixture,
} from "./test-support/fixtures";
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    loading: false,
    organizationId: "org",
    appRole: "owner",
  }),
}));
vi.mock("@/hooks/useFacilityStore", () => ({
  useFacilityStore: (select: (s: { selectedFacilityId: null }) => unknown) =>
    select({ selectedFacilityId: null }),
}));
vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/insurance/documents",
  useParams: () => ({ id: "33333333-3333-4333-8333-333333333333" }),
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});
it("retains the selected upload after failure and retries the same file", async () => {
  const uploaded = vi.fn();
  vi.mocked(fetch)
    .mockResolvedValueOnce(
      Response.json({ error: "Storage unavailable" }, { status: 503 }),
    )
    .mockResolvedValueOnce(Response.json({ document: { id: documentId } }));
  render(
    <UploadInsuranceDocument
      workspace={workspaceFixture()}
      onUploaded={uploaded}
    />,
  );
  const file = new File(["%PDF-example"], "policy.pdf", {
    type: "application/pdf",
  });
  await userEvent.upload(screen.getByLabelText("Insurance file"), file);
  fireEvent.click(screen.getByRole("button", { name: "Upload for review" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Storage unavailable",
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry upload" }));
  await waitFor(() => expect(uploaded).toHaveBeenCalledWith(documentId));
  const first = vi.mocked(fetch).mock.calls[0][1]!.body as FormData;
  const second = vi.mocked(fetch).mock.calls[1][1]!.body as FormData;
  expect(first.get("file")).toEqual(second.get("file"));
});
it("keeps extraction failure recoverable with retry and manual review", async () => {
  const workspace = workspaceFixture();
  workspace.documents = [
    {
      ...documentFixture(),
      extraction_status: "failed",
      error: "Provider unavailable",
    },
  ];
  vi.mocked(fetch).mockImplementation((_url, init) =>
    Promise.resolve(
      init?.method === "POST"
        ? Response.json({ error: "Provider timed out" }, { status: 504 })
        : Response.json(workspace),
    ),
  );
  render(<InsuranceDocumentPage />);
  fireEvent.click(
    await screen.findByRole("button", { name: "Retry extraction" }),
  );
  await screen.findByText("Provider timed out");
  expect(
    screen.getByRole("button", { name: "Retry extraction" }),
  ).toBeEnabled();
  expect(
    screen.getByRole("link", { name: "Start manual draft" }),
  ).toHaveAttribute(
    "href",
    `/admin/insurance/policies/new?document_id=${documentId}`,
  );
  expect(screen.getByTitle("Insurance source document")).toBeInTheDocument();
});

it("allows retry for an expired extraction lease while retaining the source", async () => {
  const workspace = workspaceFixture();
  workspace.documents = [
    {
      ...documentFixture(),
      extraction_status: "processing",
      lease_expires_at: new Date(Date.now() - 1000).toISOString(),
    },
  ];
  vi.mocked(fetch).mockResolvedValue(Response.json(workspace));
  render(<InsuranceDocumentPage />);
  expect(
    await screen.findByRole("button", { name: "Retry extraction" }),
  ).toBeEnabled();
  expect(
    screen.getByText(/The processing lease has expired/),
  ).toBeInTheDocument();
});
it("keeps a live lease disabled then enables retry as its expiry passes", async () => {
  const workspace = workspaceFixture();
  workspace.documents = [
    {
      ...documentFixture(),
      extraction_status: "processing",
      lease_expires_at: new Date(Date.now() + 60000).toISOString(),
    },
  ];
  vi.mocked(fetch).mockResolvedValue(Response.json(workspace));
  render(<InsuranceDocumentPage />);
  expect(
    await screen.findByRole("button", { name: "Extract a review draft" }),
  ).toBeDisabled();
  const now = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61000);
  try {
    await waitFor(
      () =>
        expect(
          screen.getByRole("button", { name: "Retry extraction" }),
        ).toBeEnabled(),
      { timeout: 2500 },
    );
  } finally {
    clock.mockRestore();
  }
});
