"use client";

import type { ComponentType } from "react";

export type GraceAvatarState =
  | "idle"
  | "thinking"
  | "speaking"
  | "listening"
  | "alert"
  | "flow_active"
  | "success";

export type GraceSlotType =
  | "text"
  | "longtext"
  | "number"
  | "currency"
  | "entity_picker"
  | "choice"
  | "line_items"
  | "review";

export interface GraceSlotDefinition {
  id: string;
  label: string;
  type: GraceSlotType;
  required?: boolean;
  entity_table?: string;
  entity_search_column?: string;
  choices?: Array<{ value: string; label: string }>;
  placeholder?: string;
  helper_text?: string;
  prefill_from?: string;
  default_value?: unknown;
  show_if?: { slot_id: string; equals?: unknown; in?: unknown[]; truthy?: boolean };
  merge_strategy?: "reject" | "auto_if_unrelated" | "prompt_diff";
}

export interface GraceFlowMetadata {
  short_label: string;
  voice_intent_keywords?: string[];
  voice_open_prompt?: string;
  voice_review_prompt?: string;
  slot_schema: GraceSlotDefinition[];
  action_key?: string;
  prefill_from_route?: Record<string, string>;
}

export type GraceClassifierCategory =
  | "FLOW_DISPATCH"
  | "READ_ANSWER"
  | "AGENTIC_TASK"
  | "HUMAN_ESCALATION"
  | "CLARIFY"
  | "COST_LIMIT";

export interface GraceClassifierResult {
  category: GraceClassifierCategory;
  confidence: number;
  flow_id: string | null;
  prefilled_slots: Record<string, unknown> | null;
  answer_query: string | null;
  agentic_brief: string | null;
  escalation_reason: string | null;
  clarification_needed: string | null;
}

export interface GraceFlowDefinitionLite {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  grace_metadata: GraceFlowMetadata;
  high_value_threshold_cents: number | null;
}

export interface GraceOrchestratorResponse {
  ok: boolean;
  conversation_id?: string;
  classification?: GraceClassifierResult;
  flow_definition?: GraceFlowDefinitionLite | null;
  degradation_state?: "full" | "reduced" | "cached" | "escalated";
  tokens_today?: number;
  latency_ms?: number;
  model?: string;
  message?: string;
  category?: string;
}

export interface GraceExecuteResponse {
  ok: boolean;
  run_id?: string;
  status?: string;
  result?: Record<string, unknown>;
  undo_deadline?: string;
  undo_handler?: string | null;
  total_cents?: number;
  error?: string;
  failed_step?: string;
  conflict?: { slot_id: string; entity_table: string; current_updated_at: string };
  threshold_cents?: number;
  message?: string;
  replay?: boolean;
}

export interface GraceUndoResponse {
  ok: boolean;
  run_id?: string;
  compensation_log?: Array<{ step: string; ok: boolean; detail?: string }>;
  error?: string;
  message?: string;
}

export interface GraceKnowledgeSource {
  title: string;
  excerpt: string;
  confidence: number;
  section_title?: string | null;
}

export interface GraceKnowledgeMeta {
  trace_id: string;
  conversation_id: string;
  model: string;
  answer_mode?: "deterministic" | "agentic" | "mixed" | null;
  resolved_domain?: string | null;
  resolved_scope_label?: string | null;
  resolved_time_window_label?: string | null;
}

export type GraceKnowledgeStatus = "idle" | "connecting" | "streaming" | "done" | "error";

export interface GraceChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
  citations?: GraceKnowledgeSource[];
  answerMode?: "deterministic" | "agentic" | "mixed" | null;
  resolvedDomain?: string | null;
  resolvedScopeLabel?: string | null;
  resolvedTimeWindowLabel?: string | null;
  createdAt: number;
}

export interface GraceUndoToastState {
  run_id: string;
  flow_label: string;
  flow_slug: string;
  result: Record<string, unknown>;
  expires_at: number;
}

/** How a quick action behaves when clicked */
export type GraceTemplateAction =
  /** Only focus the composer (e.g. open-ended ask) */
  | "focus_only"
  /** Send phrase through knowledge-agent (live data + KB) */
  | "send_knowledge"
  /** Run grace-orchestrator to possibly dispatch a structured flow */
  | "route_flow";

export interface GraceTemplate {
  id: string;
  title: string;
  subtitle: string;
  icon: ComponentType<{ className?: string }>;
  roles: string[];
  type: "knowledge" | "flow";
  /** Full question or prompt; may include {facilityName} replaced client-side */
  phrase: string;
  flow_slug?: string;
  /** @deprecated Prefer `action`; kept for older call sites */
  knowledge_only?: boolean;
  /** Quick action behavior; if omitted, inferred from `flow_slug` */
  action?: GraceTemplateAction;
}
