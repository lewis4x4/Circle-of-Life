import { NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import {
  isPublicationPreview,
  isRequirementRecord,
  mapRequirementRpcError,
  publicationBodySchema,
  type RequirementPublicationRpc,
} from "@/lib/operations/requirements";
import {
  SCHEDULE_EVALUATOR_VERSION,
  SCHEDULE_UNKNOWN_REASON,
  localDateOf,
  previewOccurrences,
  validateScheduleRule,
} from "@/lib/operations/schedule-evaluator";
import type { AppRole } from "@/lib/rbac";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCHEDULE_PREVIEW_COUNT = 6;

export type SchedulePreview = {
  evaluator_version: typeof SCHEDULE_EVALUATOR_VERSION;
  status: "confirmed" | "needs_confirmation";
  /** Null when the schedule is unknown or the rule cannot be evaluated. */
  next_occurrences: Array<{ occurrence_date: string; due_at: string; grace_ends_at: string | null; remind_at: string | null; adjustments: string[] }> | null;
  unresolved: string | null;
  problems: string[];
};

/**
 * Next-due preview for a site draft (COL-137): the same evaluator the
 * scheduler and task views use, applied to the draft's proposed rule from the
 * proposed effective time. A needs_confirmation schedule previews as unknown;
 * an invalid rule previews its problems; nothing here confirms a schedule.
 */
export function buildSchedulePreview(preview: Record<string, unknown>, effectiveFrom: string): SchedulePreview {
  const status = preview.proposed_schedule_status === "confirmed" ? "confirmed" : "needs_confirmation";
  if (status !== "confirmed") {
    return { evaluator_version: SCHEDULE_EVALUATOR_VERSION, status, next_occurrences: null, unresolved: SCHEDULE_UNKNOWN_REASON, problems: [] };
  }
  const validated = validateScheduleRule(preview.proposed_schedule_rule);
  if (!validated.ok) {
    return { evaluator_version: SCHEDULE_EVALUATOR_VERSION, status, next_occurrences: null, unresolved: null, problems: validated.problems };
  }
  const start = new Date(effectiveFrom);
  const fromDate = Number.isNaN(start.getTime()) ? null : localDateOf(start, validated.rule.timezone);
  if (!fromDate) {
    return { evaluator_version: SCHEDULE_EVALUATOR_VERSION, status, next_occurrences: null, unresolved: "effective time is not a timestamp", problems: [] };
  }
  const listed = previewOccurrences(validated.rule, fromDate, SCHEDULE_PREVIEW_COUNT + 1);
  if (listed.kind === "unresolved") {
    return { evaluator_version: SCHEDULE_EVALUATOR_VERSION, status, next_occurrences: null, unresolved: listed.reason, problems: [] };
  }
  // An undecidable date before the first occurrence means next-due is unknown, as nextOccurrenceDate reports it.
  const firstUnresolved = listed.unresolved[0];
  if (firstUnresolved && (!listed.occurrences[0] || firstUnresolved.date < listed.occurrences[0].occurrence_date)) {
    return { evaluator_version: SCHEDULE_EVALUATOR_VERSION, status, next_occurrences: null, unresolved: `${firstUnresolved.date}: ${firstUnresolved.reason}`, problems: [] };
  }
  // An occurrence on the effective date that falls due before the effective instant is not governed by this configuration.
  const governed = listed.occurrences.filter((occurrence) => occurrence.due_at >= start.toISOString()).slice(0, SCHEDULE_PREVIEW_COUNT);
  return {
    evaluator_version: SCHEDULE_EVALUATOR_VERSION,
    status,
    next_occurrences: governed.map((occurrence) => ({
      occurrence_date: occurrence.occurrence_date,
      due_at: occurrence.due_at,
      grace_ends_at: occurrence.grace_ends_at,
      remind_at: occurrence.remind_at,
      adjustments: occurrence.adjustments,
    })),
    unresolved: listed.unresolved[0] ? `${listed.unresolved[0].date}: ${listed.unresolved[0].reason}` : null,
    problems: [],
  };
}

/**
 * Shared handler for preview and publish of central and facility requirement
 * drafts: session actor, revalidation, one authenticated command, bounded
 * error mapping. A draft id carries no site, so the site gate for facility
 * drafts is the database command itself (assert_operation_requirement_actor
 * locks the grant and checks haven.operation_facility_access before and after
 * DML); an unauthorised or unknown draft is reported as unavailable.
 */
export async function runRequirementPublication(
  request: Request,
  draftId: string,
  options: { rpc: RequirementPublicationRpc; mode: "preview" | "publish"; allowedRoles: readonly AppRole[]; scope: "central" | "facility" },
) {
  const auth = await requireOperationsActor({ allowedRoles: options.allowedRoles });
  if ("response" in auth) return auth.response;
  if (!UUID.test(draftId)) return NextResponse.json({ error: "Requirement unavailable" }, { status: 403 });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const parsed = publicationBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Provide an explicit effective_from timestamp with offset" }, { status: 400 });
  }
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.rpc(
    options.rpc as never,
    { p_draft_id: draftId, p_effective_from: parsed.data.effective_from } as never,
  );
  if (error) {
    logError(`admin.operations.requirements.${options.scope}.${options.mode}`, error, { action: "rpc", draftId });
    const mapped = mapRequirementRpcError(error);
    return NextResponse.json({ error: mapped.error }, { status: mapped.status });
  }
  const result: unknown = data;
  if (options.mode === "preview") {
    if (!isPublicationPreview(result)) return NextResponse.json({ error: "Publication preview could not be confirmed" }, { status: 500 });
    if (options.scope === "facility") {
      return NextResponse.json({ preview: { ...result, schedule_preview: buildSchedulePreview(result, parsed.data.effective_from) } });
    }
    return NextResponse.json({ preview: result });
  }
  if (!isRequirementRecord(result) || result.status !== "published") {
    return NextResponse.json({ error: "Publication could not be confirmed" }, { status: 500 });
  }
  return NextResponse.json({ version: result });
}
