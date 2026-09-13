import { describe, expect, it } from "vitest";
import { recordResidentSourceReviewSchema, residentSourceCandidatesReplySchema } from "./resident-review-sources";
const source = "00000000-0000-0000-0002-000000000003";
function review() {
  return { request_key: "review-request-001", expected_occurrence_revision: "a".repeat(64),
    period: { start_date: "2026-09-01", end_date: "2026-09-13" },
    references: [{ family: "form_1823", source_id: source, source_version: "b".repeat(64) }],
    payload: { outcome: "performed", note: "Reviewed the recorded receipt metadata" },
  };
}
describe("explicit current resident source review", () => {
  it("accepts canonical database IDs and keeps the human statement", () => {
    const parsed = recordResidentSourceReviewSchema.parse(review());
    expect(parsed.references[0].source_id).toBe(source);
    expect(parsed.payload.note).toBe("Reviewed the recorded receipt metadata");
  });
  it("requires the existing failed-outcome issue rather than inventing success", () => {
    expect(recordResidentSourceReviewSchema.safeParse({ ...review(), payload: { outcome: "failed" } }).success).toBe(false);
  });
  it.each([
    { performed_at: "2026-09-01T12:00:00Z" },
    { entry_kind: "late", entry_reason: "Earlier review" },
    { performer: { kind: "other_staff", user_id: source }, entry_kind: "on_behalf", entry_reason: "Another person" },
  ])("refuses retrospective or proxy claims in the current-version pathway", extra => {
    expect(recordResidentSourceReviewSchema.safeParse({ ...review(), payload: { ...review().payload, ...extra } }).success).toBe(false);
  });
  it("refuses duplicate references, reversed periods, stale token shapes and dynamic tables", () => {
    const input = review();
    expect(recordResidentSourceReviewSchema.safeParse({ ...input, references: [...input.references, ...input.references] }).success).toBe(false);
    expect(recordResidentSourceReviewSchema.safeParse({ ...input, period: { start_date: "2026-09-13", end_date: "2026-09-01" } }).success).toBe(false);
    expect(recordResidentSourceReviewSchema.safeParse({ ...input, references: [{ ...input.references[0], source_version: "updated_at" }] }).success).toBe(false);
    expect(recordResidentSourceReviewSchema.safeParse({ ...input, references: [{ ...input.references[0], family: "resident_medications" }] }).success).toBe(false);
  });
  it("refuses a reader response containing copied clinical fields", () => {
    const response = { task_id: source, subject_kind: "resident", eligible: true, allowed_families: ["form_1823"], family: "form_1823",
      period: review().period, availability: "available", reason: null,
      items: [{ source_id: source, source_version: "b".repeat(64), source_at: null, label: "Received metadata", evidence_meaning: "Not a provider signature" }],
      next_cursor: null, complete: true };
    expect(residentSourceCandidatesReplySchema.safeParse(response).success).toBe(true);
    expect(residentSourceCandidatesReplySchema.safeParse({ ...response, items: [{ ...response.items[0], measurements: { pulse: 80 } }] }).success).toBe(false);
  });
});
