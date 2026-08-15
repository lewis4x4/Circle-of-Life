/**
 * Quiet Operator copy for knowledge document word counts.
 * Missing counts name the gap — never fabricate a word total.
 */

export const DOCUMENT_NO_WORD_COUNT_COPY = "No word count posted";

/** Word count cell — real zero stays locale-formatted `0`; null/undefined names the gap. */
export function formatDocumentWordCount(wordCount: number | null | undefined): string {
  if (wordCount == null) return DOCUMENT_NO_WORD_COUNT_COPY;
  return wordCount.toLocaleString();
}
