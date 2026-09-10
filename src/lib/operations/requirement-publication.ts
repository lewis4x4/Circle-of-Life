import { NextResponse } from "next/server";

import { requireOperationsActor, revalidateOperationsActor } from "@/lib/operations/auth";
import {
  isPublicationPreview,
  isRequirementRecord,
  mapRequirementRpcError,
  publicationBodySchema,
  type RequirementPublicationRpc,
} from "@/lib/operations/requirements";
import type { AppRole } from "@/lib/rbac";
import { logError } from "@/lib/observability/logger";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
    return NextResponse.json({ preview: result });
  }
  if (!isRequirementRecord(result) || result.status !== "published") {
    return NextResponse.json({ error: "Publication could not be confirmed" }, { status: 500 });
  }
  return NextResponse.json({ version: result });
}
