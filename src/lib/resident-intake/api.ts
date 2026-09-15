import { NextResponse } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/observability/logger";
import { RESIDENT_FACT_REGISTRY, type FactDefinition, type ResidentFactCode } from "./fact-registry";
import {
  createResidentIntakeBodySchema,
  mapResidentIntakeRpcError,
  residentIntakeCommandBodySchema,
  residentIntakeRowSchema,
  validateResidentIntakeCommandFacts,
} from "./schemas";
import { readResidentIntakeSnapshot, snapshotErrorResponse } from "./snapshot";
import { revalidateResidentIntakeActor, requireResidentIntakeActor } from "./source-bytes";

function jsonError(status: number, outcome: string, error: string) {
  return NextResponse.json({ error, outcome }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function createResidentIntake(request: Request) {
  const auth = await requireResidentIntakeActor();
  if ("response" in auth) return auth.response;
  const body = createResidentIntakeBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "validation", "Provide a facility, request key, and valid optional resident or admission case");
  const current = await revalidateResidentIntakeActor(auth.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.client.rpc(
    "prepare_resident_record_intake" as never,
    {
      p_request_key: body.data.request_key,
      p_facility_id: body.data.facility_id,
      p_title: body.data.title ?? "Resident record packet",
      p_resident_id: body.data.resident_id ?? null,
      p_admission_case_id: body.data.admission_case_id ?? null,
    } as never,
  );
  if (error) {
    logError("resident-intake.create", error, { facilityId: body.data.facility_id });
    const mapped = mapResidentIntakeRpcError(error, "create");
    return jsonError(mapped.status, mapped.outcome, mapped.error);
  }
  const result = z.object({ intake: residentIntakeRowSchema, replayed: z.boolean() }).strict().safeParse(data);
  if (!result.success) return jsonError(503, "uncertain", "Resident intake creation could not be confirmed; re-read before retrying");
  const after = await revalidateResidentIntakeActor(current.actor);
  if ("response" in after) return after.response;
  const snapshot = await readResidentIntakeSnapshot(after.actor, result.data.intake.id);
  if (!("snapshot" in snapshot)) return snapshotErrorResponse(snapshot.error);
  return NextResponse.json({ ...snapshot.snapshot, replayed: result.data.replayed }, { status: result.data.replayed ? 200 : 201, headers: { "Cache-Control": "no-store" } });
}

export async function getResidentIntake(intakeId: string) {
  const auth = await requireResidentIntakeActor();
  if ("response" in auth) return auth.response;
  const current = await revalidateResidentIntakeActor(auth.actor);
  if ("response" in current) return current.response;
  const snapshot = await readResidentIntakeSnapshot(current.actor, intakeId);
  if (!("snapshot" in snapshot)) return snapshotErrorResponse(snapshot.error);
  return NextResponse.json(snapshot.snapshot, { headers: { "Cache-Control": "no-store" } });
}

const DATABASE_COMMAND: Record<string, string> = {
  confirm_resident_match: "link_resident",
  promote_source: "apply_source_document",
};

function factDomain(code: ResidentFactCode) {
  const group = (RESIDENT_FACT_REGISTRY[code] as FactDefinition).group;
  return group === "identity" ? "demographics" : group === "contacts" ? "contact" : group;
}

function pageRange(pageNumbers?: number[]) {
  return pageNumbers?.length ? { page_start: Math.min(...pageNumbers), page_end: Math.max(...pageNumbers) } : {};
}

function databaseCommandPayload(body: z.infer<typeof residentIntakeCommandBodySchema>): Record<string, unknown> {
  if (body.command === "manual_classify_source") {
    const payload = body.payload;
    return {
      source_id: payload.source_id,
      source_class: payload.classification,
      document_type: payload.document_class ?? null,
      confidence: payload.confidence ?? null,
      page_count: payload.page_count,
      pages: payload.pages?.map((page) => ({
        page_number: page.page_number,
        source_class: page.classification ?? payload.classification,
        document_type: page.document_class ?? payload.document_class ?? null,
        disposition: page.disposition,
        confidence: page.confidence ?? null,
      })),
      reason: payload.reason,
      expected_revision: body.expected_revision,
    };
  }
  if (body.command === "propose_manual_fact") {
    const payload = body.payload;
    return {
      source_id: payload.source_id,
      field_code: payload.field_code,
      domain: factDomain(payload.field_code),
      structured_value: payload.field_code === "resident.ssn_last_four" ? { value: payload.value } : payload.value,
      display_value: payload.display_value,
      ...pageRange(payload.page_numbers),
      confidence: payload.confidence ?? null,
      conflict: payload.conflict ?? false,
      conflict_code: payload.conflict_code ?? null,
      reason: payload.reason,
    };
  }
  if (body.command === "correct_fact") {
    const payload = body.payload;
    return {
      fact_id: payload.fact_id,
      field_code: payload.field_code,
      structured_value: payload.field_code === "resident.ssn_last_four" ? { value: payload.value } : payload.value,
      display_value: payload.display_value,
      ...pageRange(payload.page_numbers),
      conflict: payload.conflict ?? false,
      conflict_code: payload.conflict_code ?? null,
      reason: payload.reason,
      expected_revision: payload.fact_revision,
    };
  }
  if (body.command === "approve_fact" || body.command === "reject_fact" || body.command === "apply_fact") {
    const payload = body.payload;
    return { ...payload, expected_revision: payload.fact_revision };
  }
  if (body.command === "promote_source") {
    const payload = body.payload;
    return payload.mode === "replace"
      ? { source_id: payload.source_id, promotion_mode: "replace", replace_document_id: payload.resident_document_id, expected_revision: body.expected_revision, reason: payload.reason }
      : { source_id: payload.source_id, promotion_mode: "add", expected_revision: body.expected_revision, reason: payload.reason };
  }
  return { ...body.payload, expected_revision: body.expected_revision };
}

export async function commandResidentIntake(request: Request, intakeId: string) {
  const auth = await requireResidentIntakeActor();
  if ("response" in auth) return auth.response;
  const body = residentIntakeCommandBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return jsonError(400, "validation", "Resident intake command contains an invalid value");
  const factValue = validateResidentIntakeCommandFacts(body.data);
  if (!factValue.success) return jsonError(400, "validation", "Proposed fact does not match its controlled field schema");
  const current = await revalidateResidentIntakeActor(auth.actor);
  if ("response" in current) return current.response;
  const command = DATABASE_COMMAND[body.data.command] ?? body.data.command;
  const { data, error } = await current.actor.client.rpc(
    "resident_record_intake_command" as never,
    {
      p_intake_id: intakeId,
      p_request_key: body.data.request_key,
      p_command: command,
      p_payload: databaseCommandPayload(body.data),
    } as never,
  );
  if (error) {
    logError("resident-intake.command", error, { intakeId, command });
    const mapped = mapResidentIntakeRpcError(error, "command");
    return jsonError(mapped.status, mapped.outcome, mapped.error);
  }
  const after = await revalidateResidentIntakeActor(current.actor);
  if ("response" in after) return after.response;
  const snapshot = await readResidentIntakeSnapshot(after.actor, intakeId);
  if (!("snapshot" in snapshot)) return snapshotErrorResponse(snapshot.error);
  const receipt = data && typeof data === "object" && "receipt" in data ? (data as { receipt?: unknown }).receipt : undefined;
  return NextResponse.json({ ...snapshot.snapshot, ...(receipt ? { receipt } : {}) }, { headers: { "Cache-Control": "no-store" } });
}
