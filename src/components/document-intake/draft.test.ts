import { describe, expect, it, vi } from "vitest";

import type { CatalogRow, IntakeItem, ProposalRow } from "@/lib/document-intake/contracts";

vi.mock("@/lib/supabase/client", () => ({ createClient: () => ({}) }));

import type { ItemDetail } from "./data";
import { draftFromDetail } from "./DocumentIntakeReview";

const A = "00000000-0000-4000-8000-00000000000a";
const B = "00000000-0000-4000-8000-00000000000b";
const catalog = [{ code: "face_sheet", active: true, destination_kind: "resident_document", subject_kind: "resident" }] as unknown as CatalogRow[];

function detail(proposal: Partial<ProposalRow> | null, item: Partial<IntakeItem> = {}): ItemDetail {
  return {
    item: { display_title: null, ...item } as IntakeItem,
    proposal: proposal ? ({ suggested_title: null, catalog_code: null, candidates: [], proposed_candidate: null, document_date: null, ...proposal } as ProposalRow) : null,
    filings: [],
    events: [],
    children: [],
  };
}

describe("review draft starts from evidence only", () => {
  it("is empty with no proposal: no title, type, subject or dates, and nothing from today", () => {
    expect(draftFromDetail(detail(null), catalog)).toEqual({ title: "", catalogCode: "", subject: null, requirementId: null, documentDate: "", expirationDate: "" });
  });

  it("takes the proposal's title, type, evidenced date and unique candidate", () => {
    const d = draftFromDetail(
      detail({ suggested_title: "Face sheet — Jane Doe", catalog_code: "face_sheet", document_date: "2026-09-20", candidates: [{ kind: "resident_document", catalog_code: "face_sheet", subject_id: A, label: "Jane Doe — Room 12" }], proposed_candidate: 0 }),
      catalog,
    );
    expect(d).toMatchObject({ title: "Face sheet — Jane Doe", catalogCode: "face_sheet", documentDate: "2026-09-20", expirationDate: "", subject: { subject_id: A } });
  });

  it("does not pick a person when two candidates share the proposed name", () => {
    const d = draftFromDetail(
      detail({
        catalog_code: "face_sheet",
        candidates: [
          { kind: "resident_document", catalog_code: "face_sheet", subject_id: A, label: "Jane Doe — Room 12" },
          { kind: "resident_document", catalog_code: "face_sheet", subject_id: B, label: "Jane Doe — Room 30" },
        ],
        proposed_candidate: 0,
      }),
      catalog,
    );
    expect(d.subject).toBeNull();
    expect(d.catalogCode).toBe("face_sheet");
  });

  it("prefers the reviewer's saved title over the suggestion", () => {
    expect(draftFromDetail(detail({ suggested_title: "Suggested" }, { display_title: "Saved" }), catalog).title).toBe("Saved");
  });
});
