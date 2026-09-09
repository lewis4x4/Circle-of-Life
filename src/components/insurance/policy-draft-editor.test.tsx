// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseWorkspaceCommand } from "@/lib/insurance/workspace-schema";
import { PolicyDraftEditor } from "./policy-draft-editor";
import {
  documentFixture,
  draftFixture,
  policyId,
  workspaceFixture,
} from "./test-support/fixtures";
const navigation = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => "/admin/insurance",
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/contexts/haven-auth-context", () => ({
  useHavenAuth: () => ({
    loading: false,
    organizationId: "org",
    appRole: "owner",
  }),
}));
describe("Insurance draft review", () => {
  it.each(["verification", "endorsement", "renewal"] as const)(
    "projects real policy child rows into a valid %s draft",
    async (kind) => {
      const workspace = workspaceFixture();
      const base = {
        ...draftFixture().payload,
        id: policyId,
        verification_status: "unverified" as const,
        version: 0,
        status: "active",
      };
      base.parties = base.parties.map((p) => ({
        ...p,
        id: "row-id",
        organization_id: "org",
        policy_id: policyId,
        created_at: "now",
        deleted_at: null,
      }));
      base.facilities = base.facilities.map((p) => ({
        ...p,
        id: "row-id",
        organization_id: "org",
        policy_id: policyId,
        created_at: "now",
        deleted_at: null,
      }));
      base.coverages = [
        {
          coverage_type: "property",
          occurrence_limit_cents: null,
          aggregate_limit_cents: null,
          deductible_cents: null,
          shared_limit_group: null,
          ...{ id: "row-id", organization_id: "org", policy_id: policyId },
        },
      ];
      vi.mocked(fetch).mockResolvedValue(
        Response.json({ ...draftFixture(), revision: 1 }),
      );
      render(
        <PolicyDraftEditor
          workspace={workspace}
          basePolicy={base}
          initialKind={kind}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
      await screen.findByText(
        "Draft saved. Insurance records remain unchanged until approval.",
      );
      const command = JSON.parse(
        vi.mocked(fetch).mock.calls[0][1]!.body as string,
      );
      expect(() => parseWorkspaceCommand(command)).not.toThrow();
      expect(command.payload.payload.parties[0]).not.toHaveProperty(
        "organization_id",
      );
      expect(command.payload.payload.facilities[0]).not.toHaveProperty("id");
      expect(command.payload.payload.coverages[0]).not.toHaveProperty(
        "policy_id",
      );
      if (kind === "renewal") {
        expect(command.payload.payload.effective_date).toBe("");
        expect(command.payload.payload.parties[0].effective_from).toBe("");
      }
    },
  );

  beforeEach(() => {
    navigation.push.mockClear();
    vi.stubGlobal("fetch", vi.fn());
  });
  function renderDraft() {
    const workspace = workspaceFixture();
    workspace.documents = [documentFixture()];
    return render(
      <PolicyDraftEditor workspace={workspace} draft={draftFixture()} />,
    );
  }
  it("requires explicit confirmation and approves only the revision returned by save", async () => {
    const saved = { ...draftFixture(), revision: 3 };
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json(saved))
      .mockResolvedValueOnce(
        Response.json({ policy_id: policyId, version: 1 }),
      );
    renderDraft();
    expect(
      screen.getByRole("button", { name: "Approve and publish" }),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the critical facts/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and publish" }),
    );
    await waitFor(() =>
      expect(navigation.push).toHaveBeenCalledWith(
        `/admin/insurance/policies/${policyId}`,
      ),
    );
    const calls = vi
      .mocked(fetch)
      .mock.calls.map(([, init]) => JSON.parse(init!.body as string));
    expect(calls.map((c) => c.action)).toEqual(["save_draft", "approve_draft"]);
    expect(calls[1].payload).toMatchObject({
      revision: 3,
      confirm_evidence: true,
    });
    expect(calls[0].payload.payload.premium_cents).toBeNull();
    expect(calls[0].payload).not.toHaveProperty("organization_id");
  });
  it("retains edits on save failure and resets confirmation when facts change", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      Response.json(
        { error: "Draft changed in another session" },
        { status: 409 },
      ),
    );
    renderDraft();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the critical facts/ }),
    );
    fireEvent.change(screen.getByLabelText("Carrier"), {
      target: { value: "Corrected carrier" },
    });
    expect(
      screen.getByRole("button", { name: "Approve and publish" }),
    ).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Draft changed in another session",
    );
    expect(screen.getByLabelText("Carrier")).toHaveValue("Corrected carrier");
    expect(navigation.push).not.toHaveBeenCalled();
  });
  it("retries the saved approval receipt without writing a potentially approved draft again", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(Response.json({ ...draftFixture(), revision: 3 }))
      .mockResolvedValueOnce(
        Response.json({ error: "Evidence is missing" }, { status: 400 }),
      )

      .mockResolvedValueOnce(Response.json({ policy_id: policyId }));
    renderDraft();
    fireEvent.click(
      screen.getByRole("checkbox", { name: /I reviewed the critical facts/ }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and publish" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Evidence is missing",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Approve and publish" }),
    );
    await waitFor(() => expect(navigation.push).toHaveBeenCalled());
    const third = JSON.parse(vi.mocked(fetch).mock.calls[2][1]!.body as string);
    expect(third.action).toBe("approve_draft");
    expect(third.payload.revision).toBe(3);
  });
  it("rejects malformed currency without converting it silently to unknown", async () => {
    renderDraft();
    fireEvent.change(screen.getByLabelText("Premium (USD)"), {
      target: { value: "not money" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Premium must be a nonnegative dollar amount",
    );
    expect(fetch).not.toHaveBeenCalled();
  });
  it("keeps source pages beside field evidence and supports package coverage without another premium", () => {
    renderDraft();
    expect(screen.getByTitle("Insurance source document")).toHaveAttribute(
      "src",
      expect.stringContaining("/api/insurance/documents/"),
    );
    const originalFrame = screen.getByTitle("Insurance source document");
    fireEvent.change(screen.getByLabelText("Preview page"), {
      target: { value: "4" },
    });
    expect(screen.getByTitle("Insurance source document")).toHaveAttribute(
      "src",
      expect.stringContaining("#page=4"),
    );
    expect(screen.getByTitle("Insurance source document")).not.toBe(
      originalFrame,
    );
    fireEvent.click(screen.getByRole("button", { name: "Add coverage line" }));
    expect(screen.getByLabelText("Coverage line 1")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Premium (USD)")).toHaveLength(1);
    expect(
      screen.getByText("Evidence for Coverage line 1 · needed for approval"),
    ).toBeInTheDocument();
  });
});
