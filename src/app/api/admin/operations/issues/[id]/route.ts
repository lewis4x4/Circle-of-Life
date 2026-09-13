import { NextRequest, NextResponse } from "next/server";

import { actorCanAccessFacility, requireOperationsActor } from "@/lib/operations/auth";
import { ISSUE_EVENT_SELECT, ISSUE_LIFECYCLE_SELECT, ISSUE_VIEW_ROLES } from "@/lib/operations/issues";
import { withoutRequestHash } from "@/lib/operations/receipts";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * One issue with its lifecycle events (COL-144), read through the session so
 * the current site and subject authority governs every row. The issue row is
 * the current projection; the events are the history in write order (event_seq).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Issue not found", outcome: "missing" }, { status: 404 });
  const auth = await requireOperationsActor({ allowedRoles: ISSUE_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const { data: row, error: readError } = await auth.actor.currentActor.client
    .from("operation_issues" as never)
    .select(ISSUE_LIFECYCLE_SELECT)
    .eq("id", id)
    .maybeSingle();
  if (readError) {
    logError("admin.operations.issues.detail", readError, { action: "read", issueId: id });
    return NextResponse.json({ error: "Issue unavailable", outcome: "uncertain" }, { status: 503 });
  }
  const issue = row as (Record<string, unknown> & { id: string; organization_id: string; facility_id: string }) | null;
  if (!issue || issue.organization_id !== auth.actor.organizationId || !(await actorCanAccessFacility(auth.actor, issue.facility_id))) {
    return NextResponse.json({ error: "Issue not found", outcome: "missing" }, { status: 404 });
  }
  const { data: events, error } = await auth.actor.currentActor.client
    .from("operation_issue_events" as never)
    .select(ISSUE_EVENT_SELECT)
    .eq("organization_id", auth.actor.organizationId)
    .eq("issue_id", id)
    .order("event_seq", { ascending: true });
  if (error) {
    logError("admin.operations.issues.detail", error, { action: "events", issueId: id });
    return NextResponse.json({ error: "Issue events unavailable", outcome: "uncertain" }, { status: 503 });
  }
  return NextResponse.json({ issue: withoutRequestHash(issue), events: events ?? [] });
}
