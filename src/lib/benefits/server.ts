import { NextResponse } from "next/server";
import { z } from "zod";

import { requireCurrentApiActor, revalidateCurrentApiActor, type CurrentApiActor, type CurrentApiActorResult } from "@/lib/auth/current-api-actor";
import { databaseUuidSchema as uuid } from "@/lib/operations/database-uuid";
import { validateResidentIntakeBytes } from "@/lib/resident-intake/source-bytes";
import {
  BENEFITS_BUCKET, BENEFITS_MAX_FILE_BYTES, BENEFITS_MIME_TYPES, BENEFITS_PROGRAMS, BENEFITS_STATUSES,
  benefitsAccessSchema, benefitsCommandSchema, benefitsEventSchema, benefitsFundingSchema,
  benefitsReceiptSchema, benefitsRequirementSchema, benefitsScreeningSchema, benefitsSubmissionSchema,
  createBenefitsCaseSchema, type BenefitsDetail, type BenefitsDocument,
} from "./contracts";

export const BENEFITS_STAFF_ROLES = ["owner", "org_admin", "facility_admin", "manager", "admin_assistant", "coordinator", "nurse"] as const;
const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const permissionSchema = z.object({ can_write: z.boolean(), can_review: z.boolean(), can_manage_access: z.boolean() });
const caseSchema = z.object({
  id: uuid, organization_id: uuid, facility_id: uuid, resident_id: uuid, admission_case_id: uuid.nullable(),
  program: z.enum(BENEFITS_PROGRAMS), status: z.enum(BENEFITS_STATUSES), revision: z.number().int().positive(),
  next_action: z.string().nullable(), assigned_to: uuid.nullable(), due_date: z.string().nullable(), closure_reason: z.string().nullable(),
  screening: benefitsScreeningSchema, funding: benefitsFundingSchema, created_at: z.string(), updated_at: z.string(),
  created_by: uuid, resident_name: z.string(), facility_name: z.string(), assignee_name: z.string().nullable(),
}).passthrough();
export const benefitsDocumentRowSchema = z.object({
  id: uuid, case_id: uuid, filename: z.string().min(1).max(255), mime_type: z.enum(BENEFITS_MIME_TYPES),
  size_bytes: z.number().int().positive().max(BENEFITS_MAX_FILE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storage_path: z.string().min(1), status: z.enum(["reserved", "ready"]), document_type: z.string(),
  template_version: z.string().nullable(), created_at: z.string(), created_by: uuid,
}).passthrough();
const rowStamp = { id: uuid, case_id: uuid, created_at: z.string(), created_by: uuid };
const detailSchema = z.object({
  case: caseSchema, permissions: permissionSchema,
  requirements: z.array(benefitsRequirementSchema.extend({ id: uuid, case_id: uuid, reviewed_by: uuid.nullable(), reviewed_at: z.string().nullable(), updated_at: z.string() }).passthrough()),
  documents: z.array(benefitsDocumentRowSchema),
  events: z.array(benefitsEventSchema.extend(rowStamp).passthrough()),
  submissions: z.array(benefitsSubmissionSchema.extend({ ...rowStamp, manifest: z.array(z.object({ id: uuid, sha256: z.string(), filename: z.string() })) }).passthrough()),
  receipts: z.array(benefitsReceiptSchema.extend(rowStamp).passthrough()),
  history: z.array(z.object({ ...rowStamp, action: z.string(), payload: z.record(z.string(), z.unknown()), revision: z.number().int() }).passthrough()),
  history_has_more: z.boolean(),
});
const commandReply = z.object({ case_id: uuid, revision: z.number().int().positive(), document: benefitsDocumentRowSchema.optional() }).passthrough();

export function benefitsFailure(status = 503, message = "Benefits information could not be verified. Please retry.") {
  return NextResponse.json({ error: message }, { status, headers: noStore });
}
function rpcFailure(error: { code?: string }) {
  if (error.code === "42501" || error.code === "P0002") return benefitsFailure(404, "Benefits case or access is unavailable.");
  if (["23505", "40001", "P0001", "23514"].includes(error.code ?? "")) return benefitsFailure(409, "This action conflicts with the current case or its evidence. Refresh and review the requirements.");
  if (["22023", "22P02", "22007", "22008"].includes(error.code ?? "")) return benefitsFailure(400, "Some benefits fields are invalid.");
  return benefitsFailure();
}
export function requireBenefitsActor() {
  return requireCurrentApiActor({ allowedRoles: BENEFITS_STAFF_ROLES, scope: "benefits.authority" });
}
export async function revalidateBenefitsActor(actor: CurrentApiActor): Promise<CurrentApiActorResult> {
  const current = await revalidateCurrentApiActor(actor, { allowedRoles: BENEFITS_STAFF_ROLES, scope: "benefits.authority.revalidate" });
  if ("response" in current) return current;
  if (current.actor.id !== actor.id || current.actor.organizationId !== actor.organizationId || current.actor.appRole !== actor.appRole) {
    return { response: benefitsFailure(404, "Benefits access has changed. Refresh before continuing.") };
  }
  return current;
}
async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  if (Number(request.headers.get("content-length") || 0) > 128 * 1024) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 128 * 1024) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; } catch { return null; }
}
async function rpc(actor: CurrentApiActor, name: string, params: Record<string, unknown> = {}) {
  return actor.client.rpc(name as never, params as never);
}
export async function loadBenefitsDetail(actor: CurrentApiActor, id: string): Promise<{ detail: BenefitsDetail } | { response: NextResponse }> {
  if (!uuid.safeParse(id).success) return { response: benefitsFailure(400, "Invalid case.") };
  const current = await revalidateBenefitsActor(actor);
  if ("response" in current) return current;
  const result = await rpc(current.actor, "benefits_case_detail", { p_case_id: id });
  if (result.error) return { response: rpcFailure(result.error) };
  const parsed = detailSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.case.id !== id || parsed.data.case.organization_id !== actor.organizationId) return { response: benefitsFailure() };
  return { detail: parsed.data };
}
export async function listBenefitsCases(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const filters = z.object({ facility_id: uuid.optional(), resident_id: uuid.optional(), status: z.enum(BENEFITS_STATUSES).optional(), before: z.string().max(200).optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().safeParse(query);
  if (!filters.success) return benefitsFailure(400, "Invalid case filters.");
  const result = await rpc(auth.actor, "benefits_case_list", { p_filters: filters.data });
  if (result.error) return rpcFailure(result.error);
  const parsed = z.object({ cases: z.array(caseSchema), next_cursor: z.string().nullable() }).safeParse(result.data);
  if (!parsed.success || parsed.data.cases.some(row => row.organization_id !== auth.actor.organizationId)) return benefitsFailure();
  return NextResponse.json(parsed.data, { headers: noStore });
}
export async function createBenefitsCase(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = createBenefitsCaseSchema.safeParse(await readBody(request));
  if (!parsed.success) return benefitsFailure(400, "Select a resident and program.");
  const result = await rpc(auth.actor, "benefits_case_create", { p_resident_id: parsed.data.resident_id, p_admission_case_id: parsed.data.admission_case_id ?? null, p_program: parsed.data.program, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data); if (!reply.success) return benefitsFailure();
  return NextResponse.json(reply.data, { status: 201, headers: noStore });
}
export async function getBenefitsCase(_request: Request, id: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const result = await loadBenefitsDetail(auth.actor, id);
  return "response" in result ? result.response : NextResponse.json(result.detail, { headers: noStore });
}
export async function commandBenefitsCase(request: Request, id: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = benefitsCommandSchema.safeParse(await readBody(request));
  if (!uuid.safeParse(id).success || !parsed.success) return benefitsFailure(400, "Review the required fields and dates.");
  const result = await rpc(auth.actor, "benefits_case_command", { p_case_id: id, p_action: parsed.data.action, p_payload: parsed.data.payload, p_expected_revision: parsed.data.expected_revision, p_request_id: parsed.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data); if (!reply.success || reply.data.case_id !== id) return benefitsFailure();
  return NextResponse.json(reply.data, { headers: noStore });
}
export async function getBenefitsOptions(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const query = z.object({ facility_id: uuid.optional(), resident_id: uuid.optional(), query: z.string().max(100).optional() }).strict().safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!query.success) return benefitsFailure(400, "Invalid search.");
  const result = await rpc(auth.actor, "benefits_options", { p_facility_id: query.data.facility_id ?? null, p_query: query.data.query || query.data.resident_id || "" });
  if (result.error) return rpcFailure(result.error);
  const named = z.object({ id: uuid, name: z.string() });
  const parsed = z.object({ facilities: z.array(named), residents: z.array(named.extend({ facility_id: uuid })), assignees: z.array(named.extend({ facility_id: uuid })), can_manage_access: z.boolean() }).safeParse(result.data);
  return parsed.success ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function getBenefitsAccess() {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const result = await rpc(auth.actor, "benefits_access_list"); if (result.error) return rpcFailure(result.error);
  const parsed = z.object({ grants: z.array(z.object({ id: uuid, facility_id: uuid, user_id: uuid, can_write: z.boolean(), can_review: z.boolean(), expires_at: z.string(), revoked_at: z.string().nullable(), reason: z.string(), granted_by: uuid, updated_at: z.string(), user_name: z.string(), facility_name: z.string() })), users: z.array(z.object({ id: uuid, name: z.string() }).passthrough()), can_manage: z.boolean() }).safeParse(result.data);
  return parsed.success ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function setBenefitsAccess(request: Request) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = benefitsAccessSchema.safeParse(await readBody(request)); if (!parsed.success) return benefitsFailure(400, "Select the staff member, facility, permissions, expiry and reason.");
  const result = await rpc(auth.actor, "benefits_access_set", { p_payload: parsed.data });
  if (result.error) return rpcFailure(result.error);
  return NextResponse.json({ success: true }, { headers: noStore });
}

export const prepareBenefitsDocumentSchema = z.object({
  filename: z.string().trim().min(1).max(255), mime_type: z.enum(BENEFITS_MIME_TYPES), size_bytes: z.number().int().positive().max(BENEFITS_MAX_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), document_type: z.string().trim().min(1).max(100), template_version: z.string().max(200).nullable().optional(),
  expected_revision: z.number().int().positive(), request_id: uuid,
}).strict();
const finalizeBodySchema = z.object({ expected_revision: z.number().int().positive(), request_id: uuid }).strict();
const storageObjectSchema = z.object({ id: uuid, version: z.string(), etag: z.string(), size_bytes: z.number(), mime_type: z.string() });
const documentTargetSchema = z.object({ document: benefitsDocumentRowSchema, object: storageObjectSchema.nullable() });
async function documentTarget(actor: CurrentApiActor, caseId: string, documentId: string): Promise<{ target: z.infer<typeof documentTargetSchema> } | { response: NextResponse }> {
  const result = await rpc(actor, "benefits_document_target", { p_case_id: caseId, p_document_id: documentId });
  if (result.error) return { response: rpcFailure(result.error) };
  const parsed = documentTargetSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.document.id !== documentId || parsed.data.document.case_id !== caseId || parsed.data.document.storage_path !== `${actor.organizationId}/${caseId}/${documentId}`) return { response: benefitsFailure() };
  return { target: parsed.data };
}
export async function prepareBenefitsDocument(request: Request, caseId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = prepareBenefitsDocumentSchema.safeParse(await readBody(request));
  if (!uuid.safeParse(caseId).success || !parsed.success) return benefitsFailure(400, "Choose a PDF, JPEG or PNG within the upload size limit.");
  const { request_id, expected_revision, ...payload } = parsed.data;
  const result = await rpc(auth.actor, "benefits_case_command", { p_case_id: caseId, p_action: "prepare_document", p_payload: payload, p_expected_revision: expected_revision, p_request_id: request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data); if (!reply.success || !reply.data.document || reply.data.case_id !== caseId) return benefitsFailure();
  const current = await revalidateBenefitsActor(auth.actor); if ("response" in current) return current.response;
  const fresh = await documentTarget(current.actor, caseId, reply.data.document.id); if ("response" in fresh) return fresh.response;
  if (fresh.target.document.status === "ready") return NextResponse.json({ ...reply.data, document: fresh.target.document, upload: null }, { headers: noStore });
  const upload = await current.actor.admin.storage.from(BENEFITS_BUCKET).createSignedUploadUrl(fresh.target.document.storage_path, { upsert: false });
  if (upload.error || !upload.data) return benefitsFailure(503, "Upload reservation was saved. Retry with the same request to get an upload link.");
  const stillAuthorized = await documentTarget(current.actor, caseId, reply.data.document.id); if ("response" in stillAuthorized) return stillAuthorized.response;
  return NextResponse.json({ ...reply.data, upload: upload.data }, { headers: noStore });
}
async function downloadChecked(actor: CurrentApiActor, caseId: string, documentId: string, requireReady: boolean): Promise<{ actor: CurrentApiActor; target: z.infer<typeof documentTargetSchema>; bytes: Uint8Array } | { response: NextResponse }> {
  if (!uuid.safeParse(caseId).success || !uuid.safeParse(documentId).success) return { response: benefitsFailure(400, "Invalid document.") };
  let current = await revalidateBenefitsActor(actor); if ("response" in current) return current;
  const before = await documentTarget(current.actor, caseId, documentId); if ("response" in before) return before;
  if (!before.target.object || (requireReady && before.target.document.status !== "ready")) return { response: benefitsFailure(409, "Document upload is not complete.") };
  const downloaded = await current.actor.admin.storage.from(BENEFITS_BUCKET).download(before.target.document.storage_path);
  if (downloaded.error || !downloaded.data) return { response: benefitsFailure(503, "Document bytes are unavailable. Retry without replacing the document.") };
  if (downloaded.data.size > BENEFITS_MAX_FILE_BYTES) return { response: benefitsFailure(409, "Document size could not be verified.") };
  const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
  const doc = before.target.document;
  try {
    const hashes = validateResidentIntakeBytes(bytes, doc.mime_type, doc.size_bytes, doc.sha256);
    const object = before.target.object;
    if (object.size_bytes !== bytes.length || object.mime_type !== doc.mime_type || object.etag.replace(/^"|"$/g, "").toLowerCase() !== hashes.md5) {
      return { response: benefitsFailure(409, "Stored file identity does not match the verified document bytes.") };
    }
  }
  catch { return { response: benefitsFailure(409, "Document bytes do not match the registered file. Upload the correct original again.") }; }
  current = await revalidateBenefitsActor(actor); if ("response" in current) return current;
  const after = await documentTarget(current.actor, caseId, documentId); if ("response" in after) return after;
  if (JSON.stringify(before.target) !== JSON.stringify(after.target)) return { response: benefitsFailure(409, "Document changed during verification. Refresh and retry.") };
  return { actor: current.actor, target: after.target, bytes };
}
export async function getVerifiedBenefitsDocument(actor: CurrentApiActor, caseId: string, documentId: string): Promise<{ bytes: Uint8Array; document: BenefitsDocument } | { response: NextResponse }> {
  const result = await downloadChecked(actor, caseId, documentId, true);
  return "response" in result ? result : { bytes: result.bytes, document: result.target.document };
}
export async function finalizeBenefitsDocument(request: Request, caseId: string, documentId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const body = finalizeBodySchema.safeParse(await readBody(request)); if (!body.success) return benefitsFailure(400, "Invalid upload confirmation.");
  const verified = await downloadChecked(auth.actor, caseId, documentId, false); if ("response" in verified) return verified.response;
  const object = verified.target.object!;
  if (verified.target.document.status === "reserved") {
    const attested = await verified.actor.admin.rpc("benefits_document_attest" as never, { p_document_id: documentId, p_sha256: verified.target.document.sha256, p_size_bytes: verified.bytes.length, p_mime_type: verified.target.document.mime_type, p_object_id: object.id, p_object_version: object.version, p_etag: object.etag } as never);
    if (attested.error) return rpcFailure(attested.error);
  }
  const current = await revalidateBenefitsActor(verified.actor); if ("response" in current) return current.response;
  const result = await rpc(current.actor, "benefits_case_command", { p_case_id: caseId, p_action: "finalize_document", p_payload: { document_id: documentId }, p_expected_revision: body.data.expected_revision, p_request_id: body.data.request_id });
  if (result.error) return rpcFailure(result.error);
  const reply = commandReply.safeParse(result.data); if (!reply.success || reply.data.case_id !== caseId) return benefitsFailure();
  return NextResponse.json(reply.data, { headers: noStore });
}
export async function downloadBenefitsDocument(_request: Request, caseId: string, documentId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const verified = await getVerifiedBenefitsDocument(auth.actor, caseId, documentId); if ("response" in verified) return verified.response;
  const filename = encodeURIComponent(verified.document.filename).replace(/'/g, "%27");
  return new Response(new Blob([Buffer.from(verified.bytes)]).stream(), { headers: { ...noStore, "Content-Type": verified.document.mime_type, "Content-Length": String(verified.bytes.length), "Content-Disposition": `attachment; filename="benefits-document"; filename*=UTF-8''${filename}` } });
}
