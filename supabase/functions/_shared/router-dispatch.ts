/**
 * router-dispatch — intent-keyed dispatch layer for haven-ai-router (KB-NEXT-01).
 *
 * Today this segment ships:
 *   metric, directory, policy, regulatory, mixed, chitchat, refuse  →  end-to-end
 *   clinical_record, historical                                     →  refusal stubs
 *
 * The tool layer (KB-NEXT-02) replaces the clinical_record/historical stubs and
 * also gives `regulatory` its own corpus. Until then `regulatory` shares the
 * same `retrieve_evidence` path as `policy`.
 *
 * Every branch is a private function. Anthropic + OpenAI calls share a small
 * top-of-file wrapper for timeout / error handling. Service-role queries inside
 * dispatchers re-assert organization_id on every read — RLS is bypassed by the
 * service role key but tenancy is still enforced in code.
 */

import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  computeKpiForFacilityIds,
  type ExecKpiPayload,
} from "./exec-kpi-metrics.ts";
import { formatFacilityFactsBlock, loadFacilityFacts, type FacilityFact } from "./facility-facts.ts";
import type { IntentClassification, RouterIntent } from "./router-intent.ts";
import {
  runToolLoop,
  type ToolCallerContext,
  type ToolLoopResult,
} from "../haven-ai-router/tools.ts";

/* ------------------------------------------------------------------ */
/*  Public types                                                      */
/* ------------------------------------------------------------------ */

export type Citation = {
  kind: "kb_chunk" | "data_table" | "fact_pack";
  title: string;
  document_id?: string;
  chunk_id?: string;
  page?: number;
  score?: number;
  row_id?: string;
  source_table?: string;
};

export type DispatchArgs = {
  admin: SupabaseClient;
  intent: IntentClassification;
  question: string;
  organizationId: string;
  userRole: string;
  userId: string;
  selectedFacilityId: string | null;
  moduleContext: string | null;
  /**
   * Accessible facility ids for the caller (resolved once per request by the
   * router from `user_facility_access` / org-admin scope). Required for any
   * branch that calls KB-NEXT-02 tool RPCs; KPI/KB branches treat as optional
   * and fall back to the existing org-wide queries when empty.
   */
  facilityIds?: string[];
};

export type DispatchResult = {
  answer: string;
  citations: Citation[];
  tokensUsed: number;
  tokensIn: number;
  tokensOut: number;
  toolsUsed: string[];
  refusal?: boolean;
  refusalReason?: string;
  phiBlocked?: boolean;
  modelUsed?: string;
};

/* ------------------------------------------------------------------ */
/*  Internal types + constants                                        */
/* ------------------------------------------------------------------ */

const SONNET_MODEL = "claude-sonnet-4-6";
const EMBEDDING_MODEL = "text-embedding-3-small";
const ANTHROPIC_TIMEOUT_MS = 60_000;
const EMBEDDING_TIMEOUT_MS = 30_000;
const KB_MIN_SCORE = 0.4;
const KB_MATCH_COUNT = 8;
const MAX_ANSWER_TOKENS = 1024;
const CANNED_REFUSAL =
  "I can't help with that. I'm Haven's operations assistant — ask me about your facilities, residents, staff, compliance, or policies.";

type FacilityRow = {
  id: string;
  name: string;
  total_licensed_beds: number | null;
  entity_id: string;
};

type AlertRow = {
  id: string;
  severity: string;
  title: string;
  body: string | null;
  source_module: string;
  facility_id: string | null;
  created_at: string;
};

type EvidenceRow = {
  source_title: string;
  excerpt: string;
  confidence: number;
  section_title: string | null;
  document_id?: string;
  chunk_id?: string;
};

/* ------------------------------------------------------------------ */
/*  Shared helpers                                                    */
/* ------------------------------------------------------------------ */

function emptyResult(answer: string, extras: Partial<DispatchResult> = {}): DispatchResult {
  return {
    answer,
    citations: [],
    tokensUsed: 0,
    tokensIn: 0,
    tokensOut: 0,
    toolsUsed: [],
    ...extras,
  };
}

function centsToUsd(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function logEvent(event: string, extra: Record<string, unknown> = {}): void {
  console.log(
    JSON.stringify({
      fn: "router-dispatch",
      event,
      ...extra,
    }),
  );
}

function logError(event: string, error: unknown, extra: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      fn: "router-dispatch",
      event,
      outcome: "error",
      error_message: error instanceof Error ? error.message : String(error),
      ...extra,
    }),
  );
}

/** Anthropic Messages call returning extracted answer text + usage. */
async function callAnthropic(args: {
  systemPrompt: string;
  userContent: string;
  maxTokens?: number;
}): Promise<{ answer: string; tokensIn: number; tokensOut: number; ok: boolean }> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) {
    return { answer: "", tokensIn: 0, tokensOut: 0, ok: false };
  }
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: SONNET_MODEL,
        max_tokens: args.maxTokens ?? MAX_ANSWER_TOKENS,
        system: args.systemPrompt,
        messages: [{ role: "user", content: args.userContent }],
      }),
      signal: AbortSignal.timeout(ANTHROPIC_TIMEOUT_MS),
    });
    if (!res.ok) {
      const errText = await res.text();
      logError("anthropic_non_ok", new Error(errText.slice(0, 200)), { status: res.status });
      return { answer: "", tokensIn: 0, tokensOut: 0, ok: false };
    }
    const json = (await res.json()) as Record<string, unknown>;
    const blocks = json.content as { type: string; text?: string }[] | undefined;
    const answer = String(blocks?.find((b) => b.type === "text")?.text ?? "");
    const usage = json.usage as { input_tokens?: number; output_tokens?: number } | undefined;
    return {
      answer,
      tokensIn: Number(usage?.input_tokens ?? 0),
      tokensOut: Number(usage?.output_tokens ?? 0),
      ok: true,
    };
  } catch (err) {
    logError("anthropic_threw", err);
    return { answer: "", tokensIn: 0, tokensOut: 0, ok: false };
  }
}

async function embedQuestion(question: string): Promise<number[] | null> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: question }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    if (!res.ok) {
      logError("embedding_non_ok", new Error(`status ${res.status}`));
      return null;
    }
    const json = (await res.json()) as { data?: { embedding?: number[] }[] };
    return json.data?.[0]?.embedding ?? null;
  } catch (err) {
    logError("embedding_threw", err);
    return null;
  }
}

/** Load facilities with display name for dispatchers that need both KPIs + a fact pack. */
async function loadFacilitiesWithName(
  admin: SupabaseClient,
  organizationId: string,
): Promise<FacilityRow[]> {
  const { data, error } = await admin
    .from("facilities")
    .select("id, name, total_licensed_beds, entity_id")
    .eq("organization_id", organizationId)
    .is("deleted_at", null);
  if (error) throw new Error(error.message);
  return (data ?? []) as FacilityRow[];
}

async function loadRecentAlerts(
  admin: SupabaseClient,
  organizationId: string,
): Promise<AlertRow[]> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 30);
  const { data, error } = await admin
    .from("exec_alerts")
    .select("id, severity, title, body, source_module, facility_id, created_at")
    .eq("organization_id", organizationId)
    .is("resolved_at", null)
    .is("deleted_at", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw new Error(error.message);
  return (data ?? []) as AlertRow[];
}

function buildKpiBlock(
  facilities: FacilityRow[],
  perFacility: { facilityId: string; name: string; kpi: ExecKpiPayload }[],
  portfolioKpi: ExecKpiPayload,
  alerts: AlertRow[],
): string {
  const nameMap: Record<string, string> = {};
  for (const f of facilities) nameMap[f.id] = f.name;

  const portfolioLines = [
    `  Total occupancy: ${portfolioKpi.census.occupiedResidents}/${portfolioKpi.census.licensedBeds} beds (${portfolioKpi.census.occupancyPct ?? "N/A"}%)`,
    `  Total open invoices: ${portfolioKpi.financial.openInvoicesCount} totaling ${centsToUsd(portfolioKpi.financial.totalBalanceDueCents)}`,
    `  Total open incidents: ${portfolioKpi.clinical.openIncidents} | Med errors MTD: ${portfolioKpi.clinical.medicationErrorsMtd}`,
    `  Total open survey deficiencies: ${portfolioKpi.compliance.openSurveyDeficiencies}`,
    `  Total certifications expiring 30d: ${portfolioKpi.workforce.certificationsExpiring30d}`,
    `  Total active outbreaks: ${portfolioKpi.infection.activeOutbreaks}`,
  ].join("\n");

  const facilityLines = perFacility
    .map((pf) => {
      const k = pf.kpi;
      return [
        `  ${pf.name}:`,
        `    Occupancy: ${k.census.occupiedResidents}/${k.census.licensedBeds} beds (${k.census.occupancyPct ?? "N/A"}%)`,
        `    Open invoices: ${k.financial.openInvoicesCount} totaling ${centsToUsd(k.financial.totalBalanceDueCents)}`,
        `    Open incidents: ${k.clinical.openIncidents} | Med errors MTD: ${k.clinical.medicationErrorsMtd}`,
        `    Open survey deficiencies: ${k.compliance.openSurveyDeficiencies}`,
        `    Certifications expiring 30d: ${k.workforce.certificationsExpiring30d}`,
        `    Active outbreaks: ${k.infection.activeOutbreaks}`,
      ].join("\n");
    })
    .join("\n\n");

  const alertLines =
    alerts.length > 0
      ? alerts
          .map((a) => {
            const facLabel = a.facility_id ? nameMap[a.facility_id] ?? "Unknown" : "Portfolio";
            return `  - [${a.severity.toUpperCase()}] ${facLabel}: ${a.title}${
              a.body ? ` — ${a.body.slice(0, 120)}` : ""
            }`;
          })
          .join("\n")
      : "  (none)";

  return [
    "PORTFOLIO SUMMARY:",
    portfolioLines,
    "",
    "FACILITY-BY-FACILITY KPIs:",
    facilityLines,
    "",
    "RECENT ALERTS (open, last 30 days):",
    alertLines,
  ].join("\n");
}

async function loadKpiBundle(admin: SupabaseClient, organizationId: string): Promise<{
  facilities: FacilityRow[];
  portfolio: ExecKpiPayload;
  perFacility: { facilityId: string; name: string; kpi: ExecKpiPayload }[];
  alerts: AlertRow[];
}> {
  const facilities = await loadFacilitiesWithName(admin, organizationId);
  const facilityHandles = facilities.map((f) => ({ id: f.id, total_licensed_beds: f.total_licensed_beds }));
  const [portfolio, perFacility, alerts] = await Promise.all([
    computeKpiForFacilityIds(admin, organizationId, facilityHandles),
    Promise.all(
      facilities.map(async (f) => {
        const kpi = await computeKpiForFacilityIds(admin, organizationId, [
          { id: f.id, total_licensed_beds: f.total_licensed_beds },
        ]);
        return { facilityId: f.id, name: f.name, kpi };
      }),
    ),
    loadRecentAlerts(admin, organizationId),
  ]);
  return { facilities, portfolio, perFacility, alerts };
}

function citationsFromEvidence(rows: EvidenceRow[]): Citation[] {
  return rows.map((r) => ({
    kind: "kb_chunk",
    title: r.source_title,
    document_id: r.document_id,
    chunk_id: r.chunk_id,
    score: r.confidence,
  }));
}

/* ------------------------------------------------------------------ */
/*  Tool-loop adapters (KB-NEXT-02)                                    */
/* ------------------------------------------------------------------ */

/** Build the caller context passed on every tool-RPC call. Returns null when
 *  the upstream router did not resolve facility ids (defensive — every tool
 *  call requires that array to enforce facility scope). */
function makeCallerContext(args: DispatchArgs): ToolCallerContext | null {
  if (!args.organizationId || !args.userId) return null;
  if (!args.facilityIds) return null;
  return {
    organizationId: args.organizationId,
    userId: args.userId,
    role: args.userRole,
    facilityIds: args.facilityIds,
  };
}

function loopDeliveredAnswer(loop: ToolLoopResult): boolean {
  if (loop.refusal) return false;
  return typeof loop.answer === "string" && loop.answer.trim().length > 0;
}

function toolLoopToDispatchResult(
  loop: ToolLoopResult,
  toolsUsedPrefix: string[] = [],
): DispatchResult {
  return {
    answer: loop.answer,
    citations: loop.citations.map<Citation>((c) => ({
      kind: c.kind,
      title: c.title,
      row_id: c.row_id,
      source_table: c.source_table,
    })),
    tokensUsed: loop.tokensIn + loop.tokensOut,
    tokensIn: loop.tokensIn,
    tokensOut: loop.tokensOut,
    toolsUsed: [...toolsUsedPrefix, ...loop.toolsUsed],
    refusal: loop.refusal,
    refusalReason: loop.refusalReason,
    modelUsed: loop.modelUsed,
  };
}

/* ------------------------------------------------------------------ */
/*  Branch: chitchat                                                   */
/* ------------------------------------------------------------------ */

async function dispatchChitchat(args: DispatchArgs): Promise<DispatchResult> {
  const systemPrompt = `You are Haven, an operations assistant for assisted living facility operators in Florida.

The user has sent a greeting, meta-question, or casual rapport message. Respond briefly and warmly, then steer them toward what you can help with: facilities, residents (no PHI without authorization), staff, compliance, policies, and operational KPIs.

Keep your response to 2–3 short sentences. Do not fabricate any data.`;

  const result = await callAnthropic({
    systemPrompt,
    userContent: args.question,
    maxTokens: 256,
  });

  if (!result.ok) {
    return emptyResult(
      "Hi! I'm Haven — your operations assistant. Ask me about your facilities, residents, staff, compliance, or policies.",
      { toolsUsed: ["chitchat_fallback"], modelUsed: SONNET_MODEL },
    );
  }

  return {
    answer: result.answer,
    citations: [],
    tokensUsed: result.tokensIn + result.tokensOut,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    toolsUsed: ["chitchat"],
    modelUsed: SONNET_MODEL,
  };
}

/* ------------------------------------------------------------------ */
/*  Branch: refuse                                                     */
/* ------------------------------------------------------------------ */

function dispatchRefuse(_args: DispatchArgs): DispatchResult {
  return emptyResult(CANNED_REFUSAL, {
    refusal: true,
    refusalReason: "out_of_scope",
    toolsUsed: ["refuse"],
  });
}

/* ------------------------------------------------------------------ */
/*  Branch: directory                                                  */
/* ------------------------------------------------------------------ */

async function loadDirectoryBlock(
  admin: SupabaseClient,
  organizationId: string,
): Promise<{ block: string; facts: FacilityFact[] }> {
  const facts = await loadFacilityFacts(admin, organizationId);
  return { block: formatFacilityFactsBlock(facts), facts };
}

/** Citation list from the always-loaded fact-pack — used as the directory branch's
 *  resilience fallback (when the tool loop can't be used or returns empty). */
function citationsFromFacts(facts: FacilityFact[]): Citation[] {
  return facts.map((f) => ({
    kind: "fact_pack",
    title: f.name,
    row_id: f.id,
    source_table: "facilities",
  }));
}

/** Direct-load (Phase-0 fact-pack) directory branch. Used as fallback when the
 *  KB-NEXT-02 tool loop is not available or fails. */
async function dispatchDirectoryFactPack(args: DispatchArgs): Promise<DispatchResult> {
  let block = "";
  let facts: FacilityFact[] = [];
  try {
    const loaded = await loadDirectoryBlock(args.admin, args.organizationId);
    block = loaded.block;
    facts = loaded.facts;
  } catch (err) {
    logError("directory_load_failed", err);
    return emptyResult(
      "I couldn't load the facility directory right now. Please try again in a moment.",
      { refusal: true, refusalReason: "directory_load_failed", toolsUsed: ["facility_facts"] },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You are Haven, an operations assistant for assisted living facility operators in Florida.

CURRENT DATE: ${today}

${block}

INSTRUCTIONS:
- The user's question is enclosed in <user_question> tags.
- Answer ONLY using the FACILITY DIRECTORY above. Do not invent facts.
- If the directory does not contain the answer, say so plainly and suggest who could provide it.
- Keep the answer concise (1–2 paragraphs). Refer to facilities by name.`;

  const result = await callAnthropic({
    systemPrompt,
    userContent: `<user_question>\n${args.question}\n</user_question>`,
  });

  if (!result.ok) {
    return emptyResult(
      "I couldn't reach the AI service right now. Please try again in a moment.",
      { refusal: true, refusalReason: "model_unavailable", toolsUsed: ["facility_facts"] },
    );
  }

  return {
    answer: result.answer,
    citations: citationsFromFacts(facts),
    tokensUsed: result.tokensIn + result.tokensOut,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    toolsUsed: ["facility_facts"],
    modelUsed: SONNET_MODEL,
  };
}

/** Tool-loop directory branch (KB-NEXT-02). Falls back to the fact-pack path
 *  when the tool loop is unavailable, errors, or returns no answer. */
async function dispatchDirectory(args: DispatchArgs): Promise<DispatchResult> {
  const caller = makeCallerContext(args);
  if (!caller) {
    return await dispatchDirectoryFactPack(args);
  }

  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You are Haven, an operations assistant for assisted living facility operators in Florida.

CURRENT DATE: ${today}

You have access to structured tool calls (facility_directory, staff_directory, org_chart, facility_medicaid_providers). Prefer tool calls over general knowledge. Cite specific facility names. If a tool returns no rows or an error, say so plainly and do not invent facts.

INSTRUCTIONS:
- Use the structured tools to answer the user's question.
- Reference facilities and people by name.
- Keep the final answer concise (1–2 paragraphs).`;

  const loop = await runToolLoop({
    admin: args.admin,
    systemPrompt,
    userQuestion: args.question,
    caller,
    allowedToolNames: [
      "facility_directory",
      "staff_directory",
      "org_chart",
      "facility_medicaid_providers",
    ],
  });

  if (loopDeliveredAnswer(loop)) {
    return toolLoopToDispatchResult(loop, ["directory_tool_loop"]);
  }

  logEvent("directory_tool_loop_fallback", {
    reason: loop.refusalReason ?? "empty_answer",
  });
  return await dispatchDirectoryFactPack(args);
}

/* ------------------------------------------------------------------ */
/*  Branch: metric                                                     */
/* ------------------------------------------------------------------ */

async function dispatchMetric(args: DispatchArgs): Promise<DispatchResult> {
  let bundle: Awaited<ReturnType<typeof loadKpiBundle>>;
  try {
    bundle = await loadKpiBundle(args.admin, args.organizationId);
  } catch (err) {
    logError("kpi_load_failed", err);
    return emptyResult(
      "I couldn't load operational metrics right now. Please try again in a moment.",
      { refusal: true, refusalReason: "kpi_load_failed", toolsUsed: ["exec_kpi"] },
    );
  }

  if (bundle.facilities.length === 0) {
    return emptyResult("I don't see any facilities for your organization yet.", {
      refusal: true,
      refusalReason: "no_facilities",
      toolsUsed: ["exec_kpi"],
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const kpiBlock = buildKpiBlock(bundle.facilities, bundle.perFacility, bundle.portfolio, bundle.alerts);
  const caller = makeCallerContext(args);

  // KB-NEXT-02 augmentation: when the caller's facility scope is known we
  // give the model the static KPI block PLUS the tool loop so it can drill
  // into incidents / AR / certs / follow-ups when the question is more
  // specific than the static aggregates.
  if (caller) {
    const systemPrompt = `You are Haven Executive Intelligence for an assisted living facility operator in Florida.

CURRENT DATE: ${today}

${kpiBlock}

You ALSO have access to drill-down tools (active_alerts, incident_summary, ar_aging_by_facility, certifications_expiring, open_followups, pilot_facility_snapshot). Use them when the question needs detail that's not in the KPI block above. The KPI block is authoritative for portfolio aggregates; the tools are authoritative for facility-scoped detail.

INSTRUCTIONS:
- The user's question is enclosed in <user_question> tags. Only answer that question.
- Use specific numbers. Do not fabricate numbers.
- If the data needed is not present, say so clearly.
- Keep answers concise (2–3 short paragraphs).
- Reference facilities by name. Format dollar amounts with $ and commas.`;

    const loop = await runToolLoop({
      admin: args.admin,
      systemPrompt,
      userQuestion: `<user_question>\n${args.question}\n</user_question>`,
      caller,
      allowedToolNames: [
        "active_alerts",
        "incident_summary",
        "ar_aging_by_facility",
        "certifications_expiring",
        "open_followups",
        "pilot_facility_snapshot",
      ],
    });

    if (loopDeliveredAnswer(loop)) {
      const facilityCites: Citation[] = bundle.facilities.map((f) => ({
        kind: "data_table",
        title: f.name,
        row_id: f.id,
        source_table: "facilities",
      }));
      const merged = toolLoopToDispatchResult(loop, ["exec_kpi", "exec_alerts"]);
      merged.citations = [...facilityCites, ...merged.citations];
      return merged;
    }
    logEvent("metric_tool_loop_fallback", { reason: loop.refusalReason ?? "empty_answer" });
  }

  const systemPrompt = `You are Haven Executive Intelligence for an assisted living facility operator in Florida.

CURRENT DATE: ${today}

${kpiBlock}

INSTRUCTIONS:
- The user's question is enclosed in <user_question> tags. Only answer that question.
- Use specific numbers from the KPI block. Do not fabricate numbers.
- If the data needed is not present, say so clearly.
- Keep answers concise (2–3 short paragraphs).
- Reference facilities by name. Format dollar amounts with $ and commas.`;

  const result = await callAnthropic({
    systemPrompt,
    userContent: `<user_question>\n${args.question}\n</user_question>`,
  });

  if (!result.ok) {
    return emptyResult(
      "I couldn't reach the AI service right now. Please try again in a moment.",
      { refusal: true, refusalReason: "model_unavailable", toolsUsed: ["exec_kpi"] },
    );
  }

  const citations: Citation[] = bundle.facilities.map((f) => ({
    kind: "data_table",
    title: f.name,
    row_id: f.id,
    source_table: "facilities",
  }));

  return {
    answer: result.answer,
    citations,
    tokensUsed: result.tokensIn + result.tokensOut,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    toolsUsed: ["exec_kpi", "exec_alerts"],
    modelUsed: SONNET_MODEL,
  };
}

/* ------------------------------------------------------------------ */
/*  Branch: policy / regulatory (KB retrieval)                         */
/* ------------------------------------------------------------------ */

async function retrieveKbEvidence(
  admin: SupabaseClient,
  organizationId: string,
  question: string,
  userRole: string,
): Promise<EvidenceRow[]> {
  const embedding = await embedQuestion(question);
  if (!embedding || embedding.length === 0) {
    logEvent("kb_no_embedding", { has_question: question.length > 0 });
    return [];
  }
  try {
    const { data, error } = await admin.rpc("retrieve_evidence", {
      query_embedding: `[${embedding.join(",")}]`,
      keyword_query: question,
      user_role: userRole,
      match_count: KB_MATCH_COUNT,
      semantic_threshold: 0.45,
      p_workspace_id: organizationId,
    });
    if (error) {
      logError("retrieve_evidence_failed", error);
      return [];
    }
    return (data ?? []) as EvidenceRow[];
  } catch (err) {
    logError("retrieve_evidence_threw", err);
    return [];
  }
}

async function logKnowledgeGap(args: {
  admin: SupabaseClient;
  organizationId: string;
  userId: string;
  question: string;
  intent?: string | null;
  facilityId?: string | null;
}): Promise<void> {
  // KB-NEXT-11: route through _kb_record_gap so frequency / merging happens
  // server-side. Signal=router_no_grounded_source identifies router-tier
  // misses (vs knowledge-agent kb_empty or chat thumbs_down).
  //
  // NOTE: p_workspace_id is TEXT in the function signature (not uuid).
  // The KB tables (documents, chunks, knowledge_gaps, chat_*) all store
  // workspace_id as text; the function was patched 2026-05-17 (commit
  // 8aca7c8) to match. Pass a string; do not cast to uuid.
  try {
    const { error } = await args.admin.rpc("_kb_record_gap", {
      p_workspace_id: args.organizationId,
      p_user_id: args.userId,
      p_question: args.question.slice(0, 2000),
      p_signal: "router_no_grounded_source",
      p_surface: "router",
      p_intent: args.intent ?? null,
      p_facility_id: args.facilityId ?? null,
      p_trace_id: null,
    });
    if (error) {
      logError("knowledge_gap_insert_failed", error);
    }
  } catch (err) {
    logError("knowledge_gap_insert_threw", err);
  }
}

function composeEvidenceContext(rows: EvidenceRow[]): string {
  if (rows.length === 0) return "(no published documents matched this question)";
  return rows
    .map((r, idx) => {
      const sect = r.section_title ? ` — ${r.section_title}` : "";
      const score = typeof r.confidence === "number" ? ` (score=${r.confidence.toFixed(2)})` : "";
      return `[#${idx + 1}] ${r.source_title}${sect}${score}\n${r.excerpt}`;
    })
    .join("\n\n---\n\n");
}

async function dispatchKbBranch(
  args: DispatchArgs,
  variant: "policy" | "regulatory",
): Promise<DispatchResult> {
  const rows = await retrieveKbEvidence(args.admin, args.organizationId, args.question, args.userRole);
  const goodRows = rows.filter((r) => typeof r.confidence === "number" && r.confidence >= KB_MIN_SCORE);

  if (goodRows.length === 0) {
    await logKnowledgeGap({
      admin: args.admin,
      organizationId: args.organizationId,
      userId: args.userId,
      question: args.question,
    });
    const tool = variant === "policy" ? "kb_policy" : "kb_regulatory";
    return emptyResult(
      `I don't have a high-confidence source for this in the knowledge base yet. I've logged the question as a gap so it can be addressed. ${
        variant === "regulatory"
          ? "For regulatory specifics, please verify directly against AHCA / FAC rule text."
          : "Once a policy doc is published, I'll be able to cite it."
      }`,
      {
        refusal: true,
        refusalReason: "no_grounded_source",
        toolsUsed: [tool, "knowledge_gaps"],
      },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const context = composeEvidenceContext(goodRows);
  const intentLabel = variant === "regulatory" ? "regulatory excerpts" : "internal policy documents";

  const systemPrompt = `You are Haven, an operations assistant for assisted living facility operators in Florida.

CURRENT DATE: ${today}

You will answer using ONLY the ${intentLabel} below. Cite the document title for every claim you make. If the documents do not contain the answer, say so clearly and do not invent content.

KNOWLEDGE BASE EXCERPTS:

${context}

INSTRUCTIONS:
- The user's question is enclosed in <user_question> tags.
- Quote or paraphrase only what the excerpts support.
- If excerpts are partial, acknowledge the limit and recommend reviewing the source doc.
- Keep the answer to 1–3 paragraphs.`;

  const result = await callAnthropic({
    systemPrompt,
    userContent: `<user_question>\n${args.question}\n</user_question>`,
  });

  if (!result.ok) {
    return emptyResult(
      "I couldn't reach the AI service right now. Please try again in a moment.",
      {
        refusal: true,
        refusalReason: "model_unavailable",
        toolsUsed: [variant === "policy" ? "kb_policy" : "kb_regulatory"],
      },
    );
  }

  return {
    answer: result.answer,
    citations: citationsFromEvidence(goodRows),
    tokensUsed: result.tokensIn + result.tokensOut,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    toolsUsed: [variant === "policy" ? "kb_policy" : "kb_regulatory"],
    modelUsed: SONNET_MODEL,
  };
}

/* ------------------------------------------------------------------ */
/*  Branch: clinical_record (PHI-gated stub)                           */
/* ------------------------------------------------------------------ */

async function dispatchClinicalRecord(args: DispatchArgs): Promise<DispatchResult & { phiBlocked?: boolean }> {
  // Look up the per-org policy. If allow_phi is false → refuse with phi_blocked.
  // (Defense in depth: the resident_summary / med_orders RPCs ALSO enforce
  // _ai_tool_phi_allowed inside their SECURITY DEFINER body. Both layers
  // refuse before any PHI columns are read.)
  let allowPhi = false;
  try {
    const { data, error } = await args.admin
      .from("ai_invocation_policies")
      .select("allow_phi")
      .eq("organization_id", args.organizationId)
      .maybeSingle();
    if (error) {
      logError("phi_policy_lookup_failed", error);
    }
    allowPhi = Boolean(data?.allow_phi);
  } catch (err) {
    logError("phi_policy_lookup_threw", err);
  }

  if (!allowPhi) {
    return {
      ...emptyResult(
        "I can't return resident-level clinical detail until your organization's PHI policy is enabled (BAA + Pro plan required). Please check with your admin.",
        {
          refusal: true,
          refusalReason: "phi_blocked",
          toolsUsed: ["phi_policy_gate"],
        },
      ),
      phiBlocked: true,
    };
  }

  const caller = makeCallerContext(args);
  if (!caller) {
    await logKnowledgeGap({
      admin: args.admin,
      organizationId: args.organizationId,
      userId: args.userId,
      question: args.question,
    });
    return emptyResult(
      "I can't complete a resident lookup right now — your facility scope is missing. Please retry.",
      {
        refusal: true,
        refusalReason: "missing_facility_scope",
        toolsUsed: ["clinical_record", "knowledge_gaps"],
      },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const systemPrompt = `You are Haven, a clinical operations assistant for assisted living staff.

CURRENT DATE: ${today}

You have access to three structured tools:
- resident_summary(resident_id): minimal identity, room, primary diagnosis, payer, advance-directive flag
- med_orders(resident_id): active medication orders
- incident_summary(facility_id, days?): incident counts + 5 most recent

PHI rules:
- Only call these tools to answer the user's specific question.
- If the question identifies a resident by name only, say you need the resident's record id (or the user should pick one from their roster); do NOT guess.
- Cite specific resident ids and order ids in your answer.
- If a tool returns role_denied, phi_blocked, facility_access_denied, or family_not_linked, surface that to the user verbatim; do NOT retry the same tool.
- Keep the final answer concise (1–3 short paragraphs).`;

  const loop = await runToolLoop({
    admin: args.admin,
    systemPrompt,
    userQuestion: args.question,
    caller,
    allowedToolNames: ["resident_summary", "med_orders", "incident_summary"],
  });

  if (!loopDeliveredAnswer(loop)) {
    await logKnowledgeGap({
      admin: args.admin,
      organizationId: args.organizationId,
      userId: args.userId,
      question: args.question,
    });
  }
  return toolLoopToDispatchResult(loop, ["clinical_record"]);
}

/* ------------------------------------------------------------------ */
/*  Branch: historical (audit_log stub)                                */
/* ------------------------------------------------------------------ */

async function dispatchHistorical(args: DispatchArgs): Promise<DispatchResult> {
  // TODO(KB-NEXT-04): wire an audit_log tool RPC and route this branch through
  // runToolLoop with allowedToolNames=['audit_log_search']. Intentionally
  // stubbed in KB-NEXT-02 because audit_log surfaces require additional
  // governance (admin-only, redaction policy, retention window) that warrants
  // its own segment.
  await logKnowledgeGap({
    admin: args.admin,
    organizationId: args.organizationId,
    userId: args.userId,
    question: args.question,
  });
  return emptyResult(
    "Audit log lookup isn't wired yet — that ships in KB-NEXT-04 with the historical tool layer. I've logged this question as a gap for follow-up.",
    {
      refusal: true,
      refusalReason: "tool_not_available",
      toolsUsed: ["historical_stub", "knowledge_gaps"],
    },
  );
}

/* ------------------------------------------------------------------ */
/*  Branch: mixed (metric + directory fan-out)                         */
/* ------------------------------------------------------------------ */

async function dispatchMixed(args: DispatchArgs): Promise<DispatchResult> {
  let bundle: Awaited<ReturnType<typeof loadKpiBundle>>;
  let dirBlock = "";
  let facts: FacilityFact[] = [];
  try {
    const [b, d] = await Promise.all([
      loadKpiBundle(args.admin, args.organizationId),
      loadDirectoryBlock(args.admin, args.organizationId),
    ]);
    bundle = b;
    dirBlock = d.block;
    facts = d.facts;
  } catch (err) {
    logError("mixed_load_failed", err);
    return emptyResult(
      "I couldn't load operational data right now. Please try again in a moment.",
      { refusal: true, refusalReason: "data_load_failed", toolsUsed: ["mixed"] },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const kpiBlock = buildKpiBlock(bundle.facilities, bundle.perFacility, bundle.portfolio, bundle.alerts);
  const caller = makeCallerContext(args);

  // KB-NEXT-02 augmentation: when facility scope is available we add the
  // tool loop so the model can deep-dive past the static directory/KPI text.
  if (caller) {
    const systemPrompt = `You are Haven, an operations assistant for assisted living facility operators in Florida. This question may need directory facts, KPI aggregates, AND facility-scoped detail.

CURRENT DATE: ${today}

${dirBlock}

${kpiBlock}

You also have structured tools available: facility_directory, staff_directory, org_chart, pilot_facility_snapshot. Use them when the static blocks above aren't enough.

INSTRUCTIONS:
- The user's question is enclosed in <user_question> tags.
- Combine the directory, KPI block, and tool results as needed. Do not fabricate.
- If part of the question can't be answered, say so plainly.
- Keep the answer concise (2–3 paragraphs). Reference facilities by name.`;

    const loop = await runToolLoop({
      admin: args.admin,
      systemPrompt,
      userQuestion: `<user_question>\n${args.question}\n</user_question>`,
      caller,
      allowedToolNames: [
        "facility_directory",
        "staff_directory",
        "org_chart",
        "pilot_facility_snapshot",
      ],
    });

    if (loopDeliveredAnswer(loop)) {
      const merged = toolLoopToDispatchResult(loop, ["exec_kpi", "exec_alerts", "facility_facts"]);
      merged.citations = [
        ...bundle.facilities.map<Citation>((f) => ({
          kind: "data_table",
          title: f.name,
          row_id: f.id,
          source_table: "facilities",
        })),
        ...citationsFromFacts(facts),
        ...merged.citations,
      ];
      return merged;
    }
    logEvent("mixed_tool_loop_fallback", { reason: loop.refusalReason ?? "empty_answer" });
  }

  const systemPrompt = `You are Haven, an operations assistant for assisted living facility operators in Florida. This question may need BOTH structured operational data AND directory facts.

CURRENT DATE: ${today}

${dirBlock}

${kpiBlock}

INSTRUCTIONS:
- The user's question is enclosed in <user_question> tags.
- Combine the directory and KPI blocks as needed. Do not fabricate any data.
- If part of the question can't be answered from the data above, say so clearly.
- Keep the answer concise (2–3 paragraphs). Reference facilities by name.`;

  const result = await callAnthropic({
    systemPrompt,
    userContent: `<user_question>\n${args.question}\n</user_question>`,
  });

  if (!result.ok) {
    return emptyResult(
      "I couldn't reach the AI service right now. Please try again in a moment.",
      { refusal: true, refusalReason: "model_unavailable", toolsUsed: ["mixed"] },
    );
  }

  const citations: Citation[] = [
    ...bundle.facilities.map<Citation>((f) => ({
      kind: "data_table",
      title: f.name,
      row_id: f.id,
      source_table: "facilities",
    })),
    ...citationsFromFacts(facts),
  ];

  return {
    answer: result.answer,
    citations,
    tokensUsed: result.tokensIn + result.tokensOut,
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    toolsUsed: ["exec_kpi", "exec_alerts", "facility_facts"],
    modelUsed: SONNET_MODEL,
  };
}

/* ------------------------------------------------------------------ */
/*  Top-level dispatch                                                 */
/* ------------------------------------------------------------------ */

export async function dispatch(args: DispatchArgs): Promise<DispatchResult> {
  const intent: RouterIntent = args.intent.intent;
  switch (intent) {
    case "metric":
      return await dispatchMetric(args);
    case "directory":
      return await dispatchDirectory(args);
    case "policy":
      return await dispatchKbBranch(args, "policy");
    case "regulatory":
      return await dispatchKbBranch(args, "regulatory");
    case "clinical_record":
      return await dispatchClinicalRecord(args);
    case "historical":
      return await dispatchHistorical(args);
    case "mixed":
      return await dispatchMixed(args);
    case "chitchat":
      return await dispatchChitchat(args);
    case "refuse":
      return dispatchRefuse(args);
    default: {
      // Exhaustiveness guard. Should never fire — TypeScript narrows the union.
      const _exhaustive: never = intent;
      return emptyResult(CANNED_REFUSAL, {
        refusal: true,
        refusalReason: `unknown_intent_${String(_exhaustive)}`,
        toolsUsed: ["refuse"],
      });
    }
  }
}
