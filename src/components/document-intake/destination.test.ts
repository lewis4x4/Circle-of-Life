import { describe, expect, it } from "vitest";

import type { Candidate, CatalogRow } from "@/lib/document-intake/contracts";

import {
  ambiguousCandidateIndexes,
  candidateName,
  filingReadiness,
  groupCatalog,
  hasNoSafeDestination,
  initialCandidateIndex,
  namesNeedingDisambiguation,
  type FilingDraft,
} from "./destination";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";

const resident = (subject_id: string | null, label: string): Candidate => ({ kind: "resident_document", catalog_code: "face_sheet", subject_id, label });

function row(over: Partial<CatalogRow>): CatalogRow {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    organization_id: "00000000-0000-4000-8000-000000000002",
    code: "face_sheet",
    label: "Face sheet / demographics",
    description: "",
    document_group: "resident",
    destination_kind: "resident_document",
    destination_category: "demographics_face_sheet",
    subject_kind: "resident",
    contains_phi: true,
    reviewer_roles: ["owner"],
    reader_enabled: true,
    jev_enabled: true,
    reader_hint: "",
    active: true,
    sort_order: 10,
    revision: 1,
    ...over,
  };
}

describe("same-name candidates are never preselected", () => {
  it("reads the name part of a label", () => {
    expect(candidateName("Jane  Doe — Room 12")).toBe("jane doe");
    expect(candidateName("Jane Doe")).toBe("jane doe");
  });

  it("starts from the proposed candidate when its name is unique", () => {
    expect(initialCandidateIndex({ candidates: [resident(A, "Jane Doe — Room 12"), resident(B, "John Roe — Room 3")], proposed_candidate: 0 })).toBe(0);
  });

  it("starts with nothing picked when two different people share the proposed name", () => {
    const candidates = [resident(A, "Jane Doe — Room 12"), resident(B, "Jane Doe — Room 30")];
    expect(ambiguousCandidateIndexes(candidates)).toEqual(new Set([0, 1]));
    expect(initialCandidateIndex({ candidates, proposed_candidate: 0 })).toBeNull();
  });

  it("does not treat the same person listed twice as ambiguous", () => {
    const candidates = [resident(A, "Jane Doe — Room 12"), resident(A, "Jane Doe")];
    expect(initialCandidateIndex({ candidates, proposed_candidate: 1 })).toBe(1);
  });

  it("starts with nothing picked when the proposal named no one or 'none'", () => {
    expect(initialCandidateIndex(null)).toBeNull();
    expect(initialCandidateIndex({ candidates: [resident(A, "Jane Doe")], proposed_candidate: null })).toBeNull();
    const none: Candidate = { kind: "none", catalog_code: "unknown", subject_id: null, label: "No safe destination" };
    expect(initialCandidateIndex({ candidates: [none], proposed_candidate: 0 })).toBeNull();
  });

  it("shows DOB only for names that repeat", () => {
    expect(namesNeedingDisambiguation(["Jane Doe", "jane doe ", "John Roe"])).toEqual(new Set(["jane doe"]));
  });
});

describe("no safe destination", () => {
  it("is when nothing usable was proposed, not when a candidate exists", () => {
    expect(hasNoSafeDestination({ candidates: [], proposed_candidate: null })).toBe(true);
    expect(hasNoSafeDestination({ candidates: [resident(A, "Jane Doe")], proposed_candidate: 0 })).toBe(false);
    expect(hasNoSafeDestination(null)).toBe(false);
  });
});

describe("filing readiness", () => {
  const draft: FilingDraft = { title: "Face sheet", catalogCode: "face_sheet", subject: { subject_id: A, label: "Jane Doe" }, requirementId: null, documentDate: "", expirationDate: "" };

  it("is ready with a type, a subject and a title", () => {
    expect(filingReadiness(draft, row({}), { requirementRequired: false, facilityKnown: true })).toEqual({ ready: true });
  });

  it("names what is missing", () => {
    expect(filingReadiness({ ...draft, subject: null }, row({}), { requirementRequired: false, facilityKnown: true })).toEqual({ ready: false, reason: "Pick the resident." });
    expect(filingReadiness({ ...draft, title: " " }, row({}), { requirementRequired: false, facilityKnown: true })).toEqual({ ready: false, reason: "Give the document a title." });
    expect(filingReadiness(draft, row({}), { requirementRequired: false, facilityKnown: false })).toEqual({ ready: false, reason: "Set the facility first." });
    expect(filingReadiness(draft, row({ destination_kind: "none", subject_kind: "none" }), { requirementRequired: false, facilityKnown: true }).ready).toBe(false);
  });

  it("needs a requirement pick for a staff file with no matching requirement", () => {
    const staff = row({ code: "staff_certification", document_group: "staff", destination_kind: "employee_file", subject_kind: "staff", destination_category: "certification" });
    expect(filingReadiness(draft, staff, { requirementRequired: true, facilityKnown: true })).toEqual({ ready: false, reason: "No staff file requirement of this kind exists for the facility" });
    expect(filingReadiness({ ...draft, requirementId: B }, staff, { requirementRequired: true, facilityKnown: true })).toEqual({ ready: true });
  });

  it("does not need a subject for a facility document", () => {
    const facility = row({ code: "facility_pest", document_group: "facility", destination_kind: "facility_document", subject_kind: "facility" });
    expect(filingReadiness({ ...draft, subject: null }, facility, { requirementRequired: false, facilityKnown: true })).toEqual({ ready: true });
  });
});

describe("catalog grouping", () => {
  it("groups active types by document group in a fixed order", () => {
    const groups = groupCatalog([
      row({ code: "vendor_coi", document_group: "vendor", sort_order: 60 }),
      row({ code: "form_1823", sort_order: 10 }),
      row({ code: "retired", active: false }),
    ]);
    expect(groups.map((g) => g.group)).toEqual(["resident", "vendor"]);
    expect(groups.flatMap((g) => g.rows.map((r) => r.code))).not.toContain("retired");
  });
});
