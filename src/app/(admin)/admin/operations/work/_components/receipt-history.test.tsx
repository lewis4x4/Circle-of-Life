import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import type { WorkspaceReceipt } from "@/lib/operations/workspace";
import { ReceiptHistory, ReceiptSummary } from "./receipt-history";

it("shows actual evidence fields, unfinished attachment states and usable finalized downloads", async () => {
  const open = vi.spyOn(window, "open").mockReturnValue(null);
  const network = vi.fn(
    async (url: string) =>
      new Response(
        JSON.stringify(
          url.endsWith("/receipts")
            ? {
                receipts: [
                  {
                    id: "receipt",
                    receipt_kind: "performance",
                    outcome: "performed",
                    values: { pressure: 12 },
                    note: "Original measurement",
                    recorder_id: "old-actor",
                    recorded_at: "2026-09-10T12:00:00Z",
                  },
                ],
              }
            : url.includes("/issues?")
              ? { issues: [] }
              : url.endsWith("/download")
                ? {
                    download: {
                      signedUrl: "https://storage.example.test/download",
                    },
                  }
                : {
                    evidence: [
                      {
                        id: "final",
                        evidence_kind: "photo",
                        rule_label: "Gauge photo",
                        state: "finalized",
                      },
                      {
                        id: "failed",
                        evidence_kind: "photo",
                        rule_label: "Failed photo",
                        state: "failed",
                      },
                      {
                        id: "linked",
                        evidence_kind: "linked_record",
                        rule_label: "Inspection",
                        state: "finalized",
                        linked_table: "facility_documents",
                        linked_record_id: "document-1",
                      },
                    ],
                  },
        ),
        { status: 200 },
      ),
  );
  vi.stubGlobal("fetch", network);
  render(
    <ReceiptHistory
      occurrenceId="task"
      facilityId="site"
      actorId="actor"
      actorName="Dana"
      timezone="America/New_York"
      refresh="1"
    />,
  );
  expect(await screen.findByText("Gauge photo · Attached")).toBeVisible();
  expect(
    screen.getByText("Failed photo · Not attached · failed"),
  ).toBeVisible();
  expect(screen.getByText(/facility_documents.*document-1/)).toBeVisible();
  expect(screen.getByText("Note: Original measurement")).toBeVisible();
  expect(screen.getByText("12")).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", { name: "Download evidence" }),
  );
  await waitFor(() =>
    expect(open).toHaveBeenCalledWith(
      "https://storage.example.test/download",
      "_blank",
      "noopener,noreferrer",
    ),
  );
  open.mockRestore();
});


it("labels original missing evidence as historical after evidence completes without rewriting attribution", () => {
  const original = Object.freeze({ id: "receipt", receipt_kind: "performance", outcome: "performed", completion_state: "performed_missing_evidence", evidence_status: "missing", evidence_status_current: "missing", recorded_at: "2026-09-10T12:00:00Z", performed_at: "2026-09-10T11:00:00Z", recorder_id: "actor", evidence_satisfied_at: null, missing_evidence: [], performer_kind: "self", note: "Original measurement" });
  const props = { actorId: "actor", actorName: "Dana", timezone: "America/New_York" };
  const view = render(<ReceiptSummary receipt={original} {...props} />);
  expect(screen.getByText("Current evidence: missing")).toBeVisible();
  const recorded = screen.getByText(/^Recorded by Dana/).textContent;
  const performed = screen.getByText(/^Performed at/).textContent;
  const finalized = Object.freeze({ ...original, evidence_status_current: "complete", evidence_satisfied_at: "2026-09-10T13:00:00Z" });
  view.rerender(<ReceiptSummary receipt={finalized} {...props} />);
  expect(screen.getByText("Current evidence: complete")).toBeVisible();
  expect(screen.getByText("Original receipt state (historical): performed_missing_evidence")).toBeVisible();
  expect(screen.queryByText("Receipt state: performed_missing_evidence")).toBeNull();
  expect(screen.queryByText(/state.*completed/)).toBeNull();
  expect(screen.getByText(/^Recorded by Dana/).textContent).toBe(recorded);
  expect(screen.getByText(/^Performed at/).textContent).toBe(performed);
  expect(screen.getByText("Note: Original measurement")).toBeVisible();
  expect(finalized.completion_state).toBe(original.completion_state);
  expect(original.evidence_status_current).toBe("missing");
});

it("does not call original evidence current when the current projection is unavailable", () => {
  render(<ReceiptSummary receipt={{ id: "legacy", evidence_status_current: null, evidence_status: "missing", completion_state: "awaiting_verification" } as unknown as WorkspaceReceipt} actorId="actor" actorName="Dana" timezone="America/New_York" />);
  expect(screen.getByText("Evidence at recording: missing")).toBeVisible();
  expect(screen.queryByText(/^Current evidence:/)).toBeNull();
  expect(screen.getByText("Original receipt state (historical): awaiting_verification")).toBeVisible();
});
