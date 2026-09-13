import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { HistoryReceiptSummary } from "./history-receipt-summary";
const receipt = {
  id: "receipt",
  recorder_id: "private-recorder-id",
  performer_kind: "staff",
  performer_user_id: "private-performer-id",
  outcome: "performed",
  evidence_status_current: "not_required",
  evidence_satisfied_at: null,
  missing_evidence: null,
};
const props = {
  actorId: "viewer",
  actorName: "Viewer",
  timezone: "America/New_York",
};
describe("History receipt people", () => {
  it("shows authoritative names with current-profile semantics", () => {
    render(
      <HistoryReceiptSummary
        {...props}
        receipt={{
          ...receipt,
          recorder_name: "Dana",
          performer_name: "Morgan",
        }}
      />,
    );
    expect(
      screen.getByText(/Recorded by Dana \(current profile name\)/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Performer: staff · Morgan \(current profile name\)/),
    ).toBeInTheDocument();
  });
  it("preserves a recorded performer label and hides unresolved person identifiers", () => {
    const { container } = render(
      <HistoryReceiptSummary
        {...props}
        receipt={{
          ...receipt,
          performer_label: "Recorded contractor",
          performer_name: "Current name",
        }}
      />,
    );
    expect(
      screen.getByText(/Recorded by Name unavailable/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Performer: staff · Recorded contractor/),
    ).toBeInTheDocument();
    expect(container.textContent).not.toContain("private-");
    expect(container.textContent).not.toContain("Current name");
  });
});
