import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ReceiptHistory } from "./receipt-history";

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
