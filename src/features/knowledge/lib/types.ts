import type { Database } from "@/types/database";

export type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];
export type ChunkRow = Database["public"]["Tables"]["chunks"]["Row"];
export type ChatConversationRow = Database["public"]["Tables"]["chat_conversations"]["Row"];
export type ChatMessageRow = Database["public"]["Tables"]["chat_messages"]["Row"];
export type KnowledgeGapRow = Database["public"]["Tables"]["knowledge_gaps"]["Row"];
export type UsageCounterRow = Database["public"]["Tables"]["usage_counters"]["Row"];
export type KBAnalyticsEventRow = Database["public"]["Tables"]["kb_analytics_events"]["Row"];
export type DocumentAuditEventRow = Database["public"]["Tables"]["document_audit_events"]["Row"];

export type DocumentAudience = "company_wide" | "department_specific" | "leadership" | "admin_owner" | "owner_only";
export type DocumentStatus = "draft" | "pending_review" | "published" | "archived" | "ingest_failed";

export interface KBSource {
  title: string;
  excerpt: string;
  confidence: number;
  section_title: string | null;
}

export interface StreamMeta {
  trace_id: string;
  conversation_id: string;
  model: string;
}

export type StreamState = "idle" | "connecting" | "streaming" | "done" | "error";

export interface KBHealthMetrics {
  totalDocuments: number;
  publishedDocuments: number;
  totalChunks: number;
  embeddingCoverage: number;
  staleDocuments: number;
  failedIngestions: number;
  avgChunksPerDoc: number;
}

export interface ChatInsight {
  totalQueries: number;
  uniqueUsers: number;
  avgTokensPerQuery: number;
  topTopics: { topic: string; count: number }[];
  positiveFeedback: number;
  negativeFeedback: number;
  gapCount: number;
}
