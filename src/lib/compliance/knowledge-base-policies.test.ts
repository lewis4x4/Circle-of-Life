import { describe, expect, it } from "vitest";

import { knowledgeBaseDocumentHref, knowledgeBasePolicyDocuments } from "@/lib/compliance/knowledge-base-policies";

const doc = (title: string, doc_type: string | null, status = "published", word_count: number | null = 100) => ({
  id: title,
  title,
  doc_type,
  status,
  word_count,
});

describe("knowledge base policy documents (COL-707)", () => {
  it("lists published policy text and leaves out machine-generated packs, terms and overrides", () => {
    const rows = [
      doc("Grace Pack - Census", "grace_pack"),
      doc("Ontology Term - Admissions", "ontology_term"),
      doc("Homewood Override - Vendors", "facility_override"),
      doc("Incident Reporting Procedure", null, "published", 507),
      doc("Policies & Procedures COL", null, "published", 16526),
      doc("Draft handbook", null, "draft"),
    ];
    expect(knowledgeBasePolicyDocuments(rows).map((r) => r.title)).toEqual([
      "Policies & Procedures COL",
      "Incident Reporting Procedure",
    ]);
  });

  it("links to the knowledge base reader", () => {
    expect(knowledgeBaseDocumentHref("abc")).toBe("/admin/knowledge/documents/abc");
  });
});

describe("Policy Library page (COL-707)", () => {
  it("lists the knowledge base's policy documents above the acknowledgment versions", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const page = readFileSync(
      path.resolve(import.meta.dirname, "../../app/(admin)/admin/compliance/policies/page.tsx"),
      "utf8",
    );
    expect(page).toContain("knowledgeBasePolicyDocuments(");
    expect(page.indexOf("Policy text in the knowledge base")).toBeLessThan(page.indexOf("Acknowledgment versions at this building"));
  });
});
