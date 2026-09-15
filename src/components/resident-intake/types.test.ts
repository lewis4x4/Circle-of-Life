import { describe, expect, it } from "vitest";

import { normalizeResidentIntakeSnapshot } from "./types";

const id = "11111111-1111-4111-8111-111111111111";

function payload(sources: unknown[] = []) {
  return {
    intake: {
      id,
      title: "Resident packet",
      state: "review",
      revision: "22222222-2222-4222-8222-222222222222",
      facility_id: "33333333-3333-4333-8333-333333333333",
      resident_id: null,
      admission_case_id: null,
    },
    sources,
    facts: [],
    matches: [],
    checklist: [],
    counts: {},
    can: { read: true, manage: true, clinical: false, payer: true, legal: true },
  };
}

describe("normalizeResidentIntakeSnapshot checklist", () => {
  it("shows the full baseline checklist before an admission case exists", () => {
    const snapshot = normalizeResidentIntakeSnapshot(payload());
    expect(snapshot.checklist.length).toBeGreaterThan(15);
    expect(snapshot.checklist.find((item) => item.key === "form_1823")).toMatchObject({
      label: "AHCA Form 1823",
      status: "missing",
    });
  });

  it("marks a classified source as awaiting review and keeps it available to add", () => {
    const snapshot = normalizeResidentIntakeSnapshot(payload([{
      id: "44444444-4444-4444-8444-444444444444",
      source_order: 1,
      title: "Form 1823",
      original_filename: "1823.pdf",
      declared_mime: "application/pdf",
      declared_size_bytes: 1200,
      state: "review",
      revision: "55555555-5555-4555-8555-555555555555",
      source_class: "resident",
      document_type: "form_1823",
      classification_confidence: 0.94,
      preflight_state: "safe",
      credential_quarantined: false,
      page_count: 3,
      canonical_document_id: null,
      promotion_mode: null,
      supersedes_document_id: null,
      finalized_at: "2026-09-15T12:00:00Z",
    }]));
    expect(snapshot.checklist.find((item) => item.key === "form_1823")).toMatchObject({
      status: "awaiting_review",
      count: 1,
      canAdd: true,
    });
  });
});
