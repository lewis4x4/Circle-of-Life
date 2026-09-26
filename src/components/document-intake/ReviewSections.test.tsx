import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

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
    expect(screen.getByText("AI not run: not authorized")).toBeTruthy();
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

  it("asks Was Jev right? only on flagged Jev checks, starting empty", () => {
    const onVerdictChange = vi.fn();
    const graded = {
      ...proposal,
      checks: [
        { code: "jev_legible_complete", label: "Legible and complete", result: "pass", source: "jev" },
        { code: "jev_signed", label: "Signed", result: "fail", source: "jev" },
        { code: "jev_type_matches", label: "Matches the type", result: "unknown", source: "jev" },
        { code: "name_match", label: "Name matches the resident", result: "fail", source: "code" },
      ],
    } as unknown as ProposalRow;
    render(
      <AssessmentSection
        item={{ processing_state: "succeeded", processing_reason: null }}
        proposal={graded}
        verdicts={{ jev_type_matches: "cant_tell" }}
        onVerdictChange={onVerdictChange}
      />,
    );
    const groups = screen.getAllByRole("radiogroup");
    expect(groups.map((g) => g.getAttribute("aria-labelledby")?.split(" ").map((id) => document.getElementById(id)?.textContent).join(" "))).toEqual([
      "Was Jev right? Signed",
      "Was Jev right? Matches the type",
    ]);
    expect(screen.getAllByText("Was Jev right?")).toHaveLength(2);
    const signed = within(groups[0]!).getAllByRole("radio");
    expect(signed.map((r) => r.textContent)).toEqual(["Right", "Wrong", "Can’t tell"]);
    expect(signed.every((r) => r.getAttribute("aria-checked") === "false")).toBe(true);
    expect(within(groups[1]!).getByRole("radio", { name: "Can’t tell" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(signed[1]!);
    expect(onVerdictChange).toHaveBeenCalledWith("jev_signed", "wrong");
  });

  it("shows no verdict control when the document cannot be filed", () => {
    const graded = { ...proposal, checks: [{ code: "jev_signed", label: "Signed", result: "fail", source: "jev" }] } as unknown as ProposalRow;
    render(<AssessmentSection item={{ processing_state: "succeeded", processing_reason: null }} proposal={graded} />);
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.queryByText("Was Jev right?")).toBeNull();
  });
});
