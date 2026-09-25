import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { ProposalRow } from "@/lib/document-intake/contracts";

import { AssessmentSection } from "./ReviewSections";

const proposal = {
  id: "00000000-0000-4000-8000-000000000001",
  item_id: "00000000-0000-4000-8000-000000000002",
  run_id: "00000000-0000-4000-8000-000000000003",
  generation: 1,
  suggested_title: "Face sheet",
  summary: null,
  summary_pages: [],
  document_date: null,
  catalog_code: "face_sheet",
  candidates: [],
  proposed_candidate: null,
  segments: [],
  reader: {},
  jev: { model: "jev-1", answers: { document_type: { type: "choice", choice: "face_sheet", probabilities: { face_sheet: 0.82, other: 0.18 } } } },
  checks: [{ code: "name_match", label: "Name matches the resident", result: "unknown", source: "code" }],
  warnings: [],
  stage_status: { reader: { state: "not_authorized", reason: "No BAA recorded" }, jev: { state: "ran" } },
  created_at: "2026-09-25T12:00:00Z",
} as unknown as ProposalRow;

describe("AssessmentSection", () => {
  it("says the reader did not run and why, and shows Jev's probability only on request", async () => {
    render(<AssessmentSection item={{ processing_state: "blocked", processing_reason: null }} proposal={proposal} />);
    expect(screen.getByText("AI not run — not authorized")).toBeTruthy();
    expect(screen.getByText("No BAA recorded")).toBeTruthy();
    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText("probability 0.82")).toBeNull();
    screen.getByRole("button", { name: "Show details" }).click();
    expect(await screen.findByText("probability 0.82")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\d%|confidence/i);
  });

  it("reports an unknown AI result when there is no proposal", () => {
    render(<AssessmentSection item={{ processing_state: "uncertain", processing_reason: null }} proposal={null} />);
    expect(screen.getAllByText(/result unknown/).length).toBe(2);
  });
});
