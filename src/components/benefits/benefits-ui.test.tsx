import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActionForm, BenefitsRequestError, benefitsFetch } from "./benefits-ui";

describe("benefits forms", () => {
  it("preserves the staff draft and request identity after uncertain failure", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(new Error("Connection interrupted"))
      .mockResolvedValue(undefined);
    render(
      <ActionForm
        title="Next action"
        fields={[{ name: "notes", label: "Notes", type: "textarea" }]}
        onSubmit={save}
      />,
    );
    fireEvent.change(screen.getByLabelText("Notes"), {
      target: { value: "Ask for the missing statement page" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Connection interrupted");
    expect(screen.getByLabelText("Notes")).toHaveValue(
      "Ask for the missing statement page",
    );
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved successfully.");
    expect(save.mock.calls[0]?.[1]).toEqual(save.mock.calls[1]?.[1]);
  });
  it("preserves a conflict draft and gives the reviewed retry a fresh request identity", async () => {
    const save = vi
      .fn()
      .mockRejectedValueOnce(
        new BenefitsRequestError("Refresh case before retry", 409),
      )
      .mockResolvedValue(undefined);
    render(
      <ActionForm
        title="Screening"
        fields={[
          { name: "income_cents", label: "Income", type: "money" },
          { name: "assets_cents", label: "Assets", type: "money" },
        ]}
        onSubmit={save}
      />,
    );
    fireEvent.change(screen.getByLabelText("Income"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Refresh case before retry");
    expect(screen.getByLabelText("Income")).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await screen.findByText("Saved successfully.");
    expect(save.mock.calls[0]?.[0]).toEqual({
      income_cents: 0,
      assets_cents: null,
    });
    expect(save.mock.calls[0]?.[1]).not.toEqual(save.mock.calls[1]?.[1]);
  });
  it("converts source timestamps from the facility clock instead of the device timezone", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(
      <ActionForm
        title="Receipt"
        fields={[
          { name: "received_at", label: "Received", type: "datetime-local" },
        ]}
        onSubmit={save}
      />,
    );
    fireEvent.change(screen.getByLabelText("Received"), {
      target: { value: "2026-09-21T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(save.mock.calls[0]?.[0]).toEqual({
      received_at: "2026-09-21T13:30:00.000Z",
    });
  });
  it("returns an explicit access error instead of an empty dataset", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 }),
        ),
    );
    await expect(benefitsFetch("/api/admin/benefits/cases")).rejects.toThrow(
      "Benefits access is restricted",
    );
    vi.unstubAllGlobals();
  });
});
