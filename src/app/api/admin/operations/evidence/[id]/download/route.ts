import { NextRequest, NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import { DOWNLOAD_URL_SECONDS, EVIDENCE_BUCKET, EVIDENCE_VIEW_ROLES, readEvidenceTarget } from "@/lib/operations/evidence";
import { logError } from "@/lib/observability/logger";

/**
 * Short-lived signed download URL for finalized evidence (COL-143). The
 * session's own Storage policy decides again on every request, so a revoked
 * grant or a transferred subject is refused here as everywhere else. Linked
 * records are read under their own access, never through this route.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireOperationsActor({ allowedRoles: EVIDENCE_VIEW_ROLES });
  if ("response" in auth) return auth.response;
  const scope = "admin.operations.evidence.download";
  const read = await readEvidenceTarget(auth.actor, id, scope);
  if ("response" in read) return read.response;
  const { target } = read;
  if (target.evidence_kind === "linked_record") {
    return NextResponse.json({ error: "Linked records are read under their own access", outcome: "conflict" }, { status: 409 });
  }
  if (target.state !== "finalized" || !target.object_path) {
    return NextResponse.json({ error: "Evidence is not finalized", outcome: "conflict" }, { status: 409 });
  }
  // Signing is a grant of bytes: recheck the actor's current authority first and sign with the revalidated session.
  const current = await revalidateOperationsActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.currentActor.client.storage.from(EVIDENCE_BUCKET).createSignedUrl(target.object_path, DOWNLOAD_URL_SECONDS, { download: true });
  if (error || !data?.signedUrl) {
    if (error) logError(scope, error, { action: "signed-url", evidenceId: id });
    return NextResponse.json({ error: "Operation unavailable", outcome: "denied" }, { status: 403 });
  }
  return NextResponse.json({ outcome: "receipt", download: { signedUrl: data.signedUrl, expires_in: DOWNLOAD_URL_SECONDS } });
}
