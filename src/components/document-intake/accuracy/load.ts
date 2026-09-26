/**
 * Reads for the Jev accuracy page. Everything goes through the signed-in
 * person's Supabase client: the two views are security_invoker (migration
 * 560), so Document Intake RLS decides which filings count. Nothing here reads
 * document text, titles, summaries or candidate names.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  buildAccuracyReport,
  windowStartIso,
  type AccuracyReport,
  type AccuracyWindow,
  type JevCheckViewRow,
  type JevOutcomeViewRow,
} from "@/lib/document-intake/jev-accuracy-report";

import { IntakeReadError, loadCatalog } from "../data";

const OUTCOME_COLUMNS =
  "filing_id,item_id,approved_at,proposed_code,filed_code,type_correct,jev_state,questions_version,jev_choice,jev_margin,margin_at_run,jev_top_correct";
const CHECK_COLUMNS = "filing_id,item_id,approved_at,filed_code,questions_version,check_code,check_label,jev_result,verdict";

/** PostgREST caps a response at 1000; read in pages, and stop at a bound no window here reaches. */
const PAGE = 1000;
const MAX_ROWS = 20_000;

type Row = Record<string, unknown>;

const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const num = (v: unknown): number | null => {
  const n = typeof v === "number" ? v : typeof v === "string" && v.trim() !== "" ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : null;
};
const bool = (v: unknown): boolean | null => (typeof v === "boolean" ? v : null);

export function parseOutcomeRow(r: Row): JevOutcomeViewRow | null {
  const filing_id = str(r.filing_id);
  const item_id = str(r.item_id);
  const approved_at = str(r.approved_at);
  const filed_code = str(r.filed_code);
  if (!filing_id || !item_id || !approved_at || !filed_code) return null;
  return {
    filing_id,
    item_id,
    approved_at,
    filed_code,
    proposed_code: str(r.proposed_code),
    type_correct: bool(r.type_correct) ?? false,
    jev_state: str(r.jev_state) ?? "none",
    questions_version: str(r.questions_version),
    jev_choice: str(r.jev_choice),
    jev_margin: num(r.jev_margin),
    margin_at_run: num(r.margin_at_run),
    jev_top_correct: bool(r.jev_top_correct),
  };
}

export function parseCheckRow(r: Row): JevCheckViewRow | null {
  const filing_id = str(r.filing_id);
  const item_id = str(r.item_id);
  const approved_at = str(r.approved_at);
  const filed_code = str(r.filed_code);
  const check_code = str(r.check_code);
  if (!filing_id || !item_id || !approved_at || !filed_code || !check_code) return null;
  return {
    filing_id,
    item_id,
    approved_at,
    filed_code,
    check_code,
    questions_version: str(r.questions_version),
    check_label: str(r.check_label),
    jev_result: str(r.jev_result),
    verdict: str(r.verdict),
  };
}

function readError(error: { code?: string; message?: string }): IntakeReadError {
  const forbidden = error.code === "42501" || /permission denied/i.test(error.message ?? "");
  return new IntakeReadError(forbidden ? "You do not have access to this." : "Jev accuracy could not be loaded. Try again in a moment.", forbidden);
}

/**
 * Pages with `.range()` are only stable over a total order. The outcomes view
 * has one row per filing; the check view has one row per filing and check, so
 * it also orders by check_code.
 */
async function readAll<T>(
  sb: SupabaseClient,
  view: string,
  columns: string,
  tieBreakers: readonly string[],
  since: string | null,
  parse: (r: Row) => T | null,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    let q = sb.from(view).select(columns).order("approved_at", { ascending: false });
    for (const column of tieBreakers) q = q.order(column, { ascending: true });
    if (since) q = q.gte("approved_at", since);
    const { data, error } = await q.range(from, from + PAGE - 1);
    if (error) throw readError(error);
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      const parsed = parse(r);
      if (parsed) out.push(parsed);
    }
    if (rows.length < PAGE) break;
  }
  return out;
}

/**
 * `routing_json.document_intake` for the signed-in person's organization, or
 * null when their role cannot read the AI policy (only owners and org admins
 * can, migration 068). The page then shows the margin the latest run used.
 */
async function loadDocumentIntakeRouting(sb: SupabaseClient): Promise<unknown | null> {
  const { data, error } = await sb.from("ai_invocation_policies").select("document_intake:routing_json->document_intake").limit(1).maybeSingle();
  if (error || !data) return null;
  return (data as { document_intake?: unknown }).document_intake ?? {};
}

/** Ids per `.in()` request, so the query string stays well under URL limits. */
const ID_CHUNK = 200;

/** destination_kind for every filing id, read in sequential chunks. A chunk that fails leaves its misses at "Not available". */
async function loadDestinationKinds(sb: SupabaseClient, filingIds: string[]): Promise<Record<string, string>> {
  const ids = [...new Set(filingIds)];
  const out: Record<string, string> = {};
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const { data, error } = await sb
      .from("document_intake_filings")
      .select("id,destination_kind")
      .in("id", ids.slice(i, i + ID_CHUNK));
    if (error || !data) continue;
    for (const r of data as Row[]) {
      if (typeof r.id === "string" && typeof r.destination_kind === "string") out[r.id] = r.destination_kind;
    }
  }
  return out;
}

export async function loadAccuracyReport(sb: SupabaseClient, window: AccuracyWindow, now: number): Promise<AccuracyReport> {
  const since = windowStartIso(window, now);
  const [outcomes, checks, catalog, routing] = await Promise.all([
    readAll(sb, "document_intake_jev_outcomes", OUTCOME_COLUMNS, ["filing_id"], since, parseOutcomeRow),
    readAll(sb, "document_intake_jev_check_outcomes", CHECK_COLUMNS, ["filing_id", "check_code"], since, parseCheckRow),
    loadCatalog(sb).catch(() => []),
    loadDocumentIntakeRouting(sb),
  ]);
  const catalogLabels = Object.fromEntries(catalog.map((c) => [c.code, c.label]));
  const draft = buildAccuracyReport({ outcomes, checks, catalogLabels, documentIntakeRouting: routing });
  if (draft.misses.length === 0) return draft;
  const destinationKinds = await loadDestinationKinds(
    sb,
    draft.misses.map((m) => m.filingId),
  );
  return buildAccuracyReport({ outcomes, checks, catalogLabels, documentIntakeRouting: routing, destinationKinds });
}
