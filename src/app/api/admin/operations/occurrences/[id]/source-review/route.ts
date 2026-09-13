import { NextResponse } from "next/server";
import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { RECEIPT_COMMAND_ROLES, isReceiptOutcome, withoutRequestHash } from "@/lib/operations/receipts";
import { recordResidentSourceReviewSchema } from "@/lib/operations/resident-review-sources";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireOperationsActor({ allowedRoles: RECEIPT_COMMAND_ROLES });
  if ("response" in auth) return auth.response;
  const { id } = await params;
  const parsed = recordResidentSourceReviewSchema.safeParse(await request.json().catch(() => null));
  if (!databaseUuidSchema.safeParse(id).success || !parsed.success) return NextResponse.json({ error: "Choose current source references, a review period and a current self review statement" }, { status: 400 });
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const input = parsed.data;
  const { data, error } = await current.actor.currentActor.client.rpc("record_resident_source_review" as never, {
    p_task: id, p_request_key: input.request_key, p_revision: input.expected_occurrence_revision,
    p_start: input.period.start_date, p_end: input.period.end_date, p_references: input.references, p_payload: input.payload,
  } as never);
  if (error) return NextResponse.json({ error: error.code === "42501" ? "Review or native source is no longer accessible" : ["40001", "23505"].includes(error.code) ? "Review or source changed; retain this request and reconcile before retry" : "Source review could not be confirmed; retain the request before retry" },
    { status: error.code === "42501" ? 404 : ["40001", "23505"].includes(error.code) ? 409 : error.code === "22023" ? 400 : 503, headers: { "Cache-Control": "no-store" } });
  const result = data as unknown as { receipt_outcome?: unknown; references?: { reference_id: string }[] };
  if (!result || !isReceiptOutcome(result.receipt_outcome) || !Array.isArray(result.references)
    || result.references.length !== input.references.length || result.references.some(ref => !databaseUuidSchema.safeParse(ref.reference_id).success))
    return NextResponse.json({ error: "Source review could not be confirmed; retain the request before retry" }, { status: 503 });
  const latest = await revalidateOperationsActor(current.actor);
  if ("response" in latest) return latest.response;
  if (latest.actor.id !== auth.actor.id || latest.actor.organizationId !== auth.actor.organizationId || latest.actor.appRole !== auth.actor.appRole)
    return NextResponse.json({ error: "Review scope unavailable" }, { status: 404 });
  const scope = await latest.actor.currentActor.client.rpc("read_resident_source_reviews" as never, { p_task: id } as never);
  if (scope.error) return NextResponse.json({ error: "Review scope unavailable" }, { status: scope.error.code === "42501" ? 404 : 503 });
  const outcome = result.receipt_outcome;
  return NextResponse.json({ outcome: "receipt", ...outcome, receipt: withoutRequestHash(outcome.receipt),
    issue: outcome.issue ? withoutRequestHash(outcome.issue) : null, references: result.references }, { headers: { "Cache-Control": "no-store" } });
}
