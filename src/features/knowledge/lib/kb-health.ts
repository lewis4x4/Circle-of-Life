import { requireHeadCount } from "@/lib/metrics/head-count";

import type { ChatInsight, KBHealthMetrics } from "./types";

type HeadCount = { count: number | null | undefined; error?: unknown };

export type KBHealthCounts = {
  totalDocs: HeadCount;
  publishedDocs: HeadCount;
  failedDocs: HeadCount;
  totalChunks: HeadCount;
  embeddedChunks: HeadCount;
  queryCount: HeadCount;
  positiveFeedback: HeadCount;
  negativeFeedback: HeadCount;
  gapCount: HeadCount;
};

/**
 * Knowledge health from head counts. A count that did not come back throws, so
 * the page shows "Could not load knowledge health" instead of 0 documents or a
 * 0.0% embedding coverage. Ratios over nothing are null, not 0 (COL-708).
 */
export function buildKBHealth(c: KBHealthCounts): { health: KBHealthMetrics; insights: ChatInsight } {
  const total = requireHeadCount(c.totalDocs, "Document count");
  const chunks = requireHeadCount(c.totalChunks, "Chunk count");
  const embedded = requireHeadCount(c.embeddedChunks, "Embedded chunk count");
  return {
    health: {
      totalDocuments: total,
      publishedDocuments: requireHeadCount(c.publishedDocs, "Published document count"),
      totalChunks: chunks,
      embeddingCoverage: chunks > 0 ? (embedded / chunks) * 100 : null,
      staleDocuments: 0,
      failedIngestions: requireHeadCount(c.failedDocs, "Failed ingestion count"),
      avgChunksPerDoc: total > 0 ? chunks / total : null,
    },
    insights: {
      totalQueries: requireHeadCount(c.queryCount, "Chat query count"),
      uniqueUsers: 0,
      avgTokensPerQuery: 0,
      topTopics: [],
      positiveFeedback: requireHeadCount(c.positiveFeedback, "Positive feedback count"),
      negativeFeedback: requireHeadCount(c.negativeFeedback, "Negative feedback count"),
      gapCount: requireHeadCount(c.gapCount, "Knowledge gap count"),
    },
  };
}
