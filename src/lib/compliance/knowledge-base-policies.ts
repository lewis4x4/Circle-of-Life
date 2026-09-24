/**
 * COL-707 (Brian, 2026-09-23): the knowledge base is canonical for policy text, and the
 * Policy Library lists the knowledge base's policy documents. The library's own rows stay:
 * they are the per-building versions staff must acknowledge.
 *
 * The knowledge base also holds machine-generated documents (Grace answer packs, ontology
 * terms, per-facility overrides). Those are classification, not policy text, so they are
 * the ones left out.
 */
export const KNOWLEDGE_BASE_NON_POLICY_DOC_TYPES = ["grace_pack", "ontology_term", "facility_override"] as const;

export type KnowledgeBaseDocumentSummary = {
  id: string;
  title: string;
  doc_type: string | null;
  status: string;
  word_count: number | null;
};

export function knowledgeBasePolicyDocuments<T extends KnowledgeBaseDocumentSummary>(rows: readonly T[]): T[] {
  const excluded = new Set<string>(KNOWLEDGE_BASE_NON_POLICY_DOC_TYPES);
  return rows
    .filter((row) => row.status === "published" && !(row.doc_type && excluded.has(row.doc_type)))
    .sort((a, b) => (b.word_count ?? 0) - (a.word_count ?? 0) || a.title.localeCompare(b.title));
}

export function knowledgeBaseDocumentHref(id: string): string {
  return `/admin/knowledge/documents/${id}`;
}
