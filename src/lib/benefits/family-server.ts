import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCurrentApiActor, revalidateCurrentApiActor, type CurrentApiActor, type CurrentApiActorResult } from "@/lib/auth/current-api-actor";
import { databaseUuidSchema as uuid } from "@/lib/operations/database-uuid";
import { validateResidentIntakeBytes } from "@/lib/resident-intake/source-bytes";
import { BENEFITS_BUCKET, BENEFITS_MAX_FILE_BYTES, BENEFITS_MIME_TYPES } from "./contracts";
import { benefitsDocumentRowSchema, benefitsFailure, requireBenefitsActor, revalidateBenefitsActor } from "./server";

const noStore = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
const familyRequestSchema = z.object({ id: uuid, resident_name: z.string(), title: z.string(), due_date: z.string().nullable(), expires_at: z.string(), requires_signature: z.boolean(), revision: z.number().int().positive(), upload: z.object({ document_id: uuid, filename: z.string(), status: z.enum(["pending", "received"]) }).nullable() });
export type FamilyBenefitsRequest = z.infer<typeof familyRequestSchema>;
const collectionSchema = z.object({ id: uuid, case_id: uuid, requirement_id: uuid, family_user_id: uuid, family_name: z.string().nullable(), requires_signature: z.boolean(), expires_at: z.string(), revoked_at: z.string().nullable(), document_id: uuid.nullable(), received_at: z.string().nullable(), created_by: uuid, created_at: z.string() });
const staffListSchema = z.object({ requests: z.array(collectionSchema), eligible_family: z.array(z.object({ id: uuid, name: z.string().nullable(), can_make_decisions: z.boolean() })) });
export type BenefitsCollectionList = z.infer<typeof staffListSchema>;
const stamp = { expected_revision: z.number().int().positive(), request_id: uuid };
const staffCommandSchema = z.discriminatedUnion("action", [
  z.object({ ...stamp, action: z.literal("assign"), payload: z.object({ requirement_id: uuid, family_user_id: uuid, expires_at: z.string().datetime({ offset: true }) }).strict() }).strict(),
  z.object({ ...stamp, action: z.literal("revoke"), payload: z.object({ collection_id: uuid }).strict() }).strict(),
]);
const uploadSchema = z.object({ ...stamp, resume_document_id: uuid.optional(), filename: z.string().trim().min(1).max(255).refine((name) => !/[\\/]/.test(name)), mime_type: z.enum(BENEFITS_MIME_TYPES), size_bytes: z.number().int().positive().max(BENEFITS_MAX_FILE_BYTES), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict();
const finalizeSchema = z.object(stamp).strict();
const replySchema = z.object({ collection_id: uuid, revision: z.number().int().positive(), document: benefitsDocumentRowSchema });
const targetSchema = z.object({ document: benefitsDocumentRowSchema, object: z.object({ id: uuid, version: z.string(), etag: z.string(), size_bytes: z.number(), mime_type: z.string() }).nullable() });

function failure(error: { code?: string }) {
  if (["42501", "P0002"].includes(error.code ?? "")) return benefitsFailure(404, "This document request is unavailable.");
  if (["23505", "40001", "55000"].includes(error.code ?? "")) return benefitsFailure(409, "The request changed or upload could not be verified. Refresh and retry.");
  if (["22023", "23514", "23502", "22P02", "22007", "22008"].includes(error.code ?? "")) return benefitsFailure(400, "Review the document request and required fields.");
  return benefitsFailure();
}
async function body(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) return null;
  const reader = request.body?.getReader(); if (!reader) return null;
  const chunks: Uint8Array[] = []; let size = 0;
  while (true) { const item = await reader.read(); if (item.done) break; size += item.value.length; if (size > 8192) { await reader.cancel(); return null; } chunks.push(item.value); }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return null; }
}
async function rpc(actor: CurrentApiActor, name: string, params: Record<string, unknown> = {}) { return actor.client.rpc(name as never, params as never); }
function requireFamily() { return requireCurrentApiActor({ allowedRoles: ["family"], scope: "benefits.family" }); }
async function revalidateFamily(actor: CurrentApiActor): Promise<CurrentApiActorResult> {
  const result = await revalidateCurrentApiActor(actor, { allowedRoles: ["family"], scope: "benefits.family.revalidate" });
  if ("response" in result) return result;
  return result.actor.id === actor.id && result.actor.organizationId === actor.organizationId && result.actor.appRole === "family" ? result : { response: benefitsFailure(404, "Family access changed.") };
}
async function target(actor: CurrentApiActor, collectionId: string, documentId: string): Promise<{ target: z.infer<typeof targetSchema>; actor: CurrentApiActor } | { response: NextResponse }> {
  if (!uuid.safeParse(collectionId).success || !uuid.safeParse(documentId).success) return { response: benefitsFailure(400, "Invalid document request.") };
  const current = await revalidateFamily(actor); if ("response" in current) return current;
  const result = await rpc(current.actor, "benefits_family_target", { p_collection_id: collectionId, p_document_id: documentId });
  if (result.error) return { response: failure(result.error) };
  const parsed = targetSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.document.id !== documentId || parsed.data.document.created_by !== actor.id || parsed.data.document.storage_path !== `${actor.organizationId}/${parsed.data.document.case_id}/${documentId}`) return { response: benefitsFailure() };
  return { target: parsed.data, actor: current.actor };
}
function publicUploadReply(reply: z.infer<typeof replySchema>, upload: unknown) {
  return { collection_id: reply.collection_id, revision: reply.revision, document: { id: reply.document.id, filename: reply.document.filename, status: reply.document.status }, upload };
}

export async function listFamilyBenefits() {
  const auth = await requireFamily(); if ("response" in auth) return auth.response;
  const result = await rpc(auth.actor, "benefits_family_list"); if (result.error) return failure(result.error);
  const parsed = z.object({ requests: z.array(familyRequestSchema).max(100) }).safeParse(result.data);
  return parsed.success ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function listBenefitsCollection(caseId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  if (!uuid.safeParse(caseId).success) return benefitsFailure(400, "Invalid case.");
  const result = await rpc(auth.actor, "benefits_collection_list", { p_case_id: caseId }); if (result.error) return failure(result.error);
  const parsed = staffListSchema.safeParse(result.data);
  return parsed.success && parsed.data.requests.every((item) => item.case_id === caseId) ? NextResponse.json(parsed.data, { headers: noStore }) : benefitsFailure();
}
export async function commandBenefitsCollection(request: Request, caseId: string) {
  const auth = await requireBenefitsActor(); if ("response" in auth) return auth.response;
  const parsed = staffCommandSchema.safeParse(await body(request));
  if (!uuid.safeParse(caseId).success || !parsed.success) return benefitsFailure(400, "Choose a requirement, authorized family member and expiry.");
  const current = await revalidateBenefitsActor(auth.actor); if ("response" in current) return current.response;
  const { action, payload, expected_revision, request_id } = parsed.data;
  const result = await rpc(current.actor, "benefits_collection_command", { p_case_id: caseId, p_action: action, p_payload: payload, p_expected_revision: expected_revision, p_request_id: request_id });
  if (result.error) return failure(result.error);
  const reply = z.object({ case_id: uuid, revision: z.number().int().positive(), collection_id: uuid }).safeParse(result.data);
  return reply.success && reply.data.case_id === caseId ? NextResponse.json(reply.data, { headers: noStore }) : benefitsFailure();
}
export async function prepareFamilyBenefitsDocument(request: Request, collectionId: string) {
  const auth = await requireFamily(); if ("response" in auth) return auth.response;
  const parsed = uploadSchema.safeParse(await body(request));
  if (!uuid.safeParse(collectionId).success || !parsed.success) return benefitsFailure(400, "Choose a PDF, PNG or JPEG up to 15 MiB.");
  const { expected_revision, request_id, resume_document_id, ...payload } = parsed.data;
  let result;
  if (resume_document_id) {
    const resumed = await target(auth.actor, collectionId, resume_document_id); if ("response" in resumed) return resumed.response;
    const doc = resumed.target.document;
    if (doc.sha256 !== payload.sha256 || doc.size_bytes !== payload.size_bytes || doc.mime_type !== payload.mime_type || doc.filename !== payload.filename) return benefitsFailure(409, "Resume with the same original file, or ask staff to replace this request.");
    result = { error: null, data: { collection_id: collectionId, revision: expected_revision, document: doc } };
  } else {
    result = await rpc(auth.actor, "benefits_family_command", { p_collection_id: collectionId, p_action: "prepare", p_payload: payload, p_expected_revision: expected_revision, p_request_id: request_id });
  }
  if (result.error) return failure(result.error);
  const reply = replySchema.safeParse(result.data); if (!reply.success || reply.data.collection_id !== collectionId) return benefitsFailure();
  const before = await target(auth.actor, collectionId, reply.data.document.id); if ("response" in before) return before.response;
  if (before.target.document.status === "ready") return NextResponse.json(publicUploadReply({ ...reply.data, document: before.target.document }, null), { headers: noStore });
  const upload = await before.actor.admin.storage.from(BENEFITS_BUCKET).createSignedUploadUrl(before.target.document.storage_path, { upsert: false });
  if (upload.error || !upload.data) return benefitsFailure(503, "Upload saved for retry. Keep this file selected and retry.");
  const after = await target(before.actor, collectionId, reply.data.document.id); if ("response" in after) return after.response;
  return NextResponse.json(publicUploadReply(reply.data, upload.data), { headers: noStore });
}
export async function finalizeFamilyBenefitsDocument(request: Request, collectionId: string, documentId: string) {
  const auth = await requireFamily(); if ("response" in auth) return auth.response;
  const parsed = finalizeSchema.safeParse(await body(request)); if (!parsed.success) return benefitsFailure(400, "Invalid upload confirmation.");
  const before = await target(auth.actor, collectionId, documentId); if ("response" in before) return before.response;
  if (!before.target.object) return benefitsFailure(409, "Upload has not arrived. Retry the selected file.");
  if (before.target.document.status !== "ready") {
    const downloaded = await before.actor.admin.storage.from(BENEFITS_BUCKET).download(before.target.document.storage_path);
    if (downloaded.error || !downloaded.data || downloaded.data.size > BENEFITS_MAX_FILE_BYTES) return benefitsFailure(503, "Upload bytes could not be verified.");
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    const doc = before.target.document;
    try { validateResidentIntakeBytes(bytes, doc.mime_type, doc.size_bytes, doc.sha256); } catch { return benefitsFailure(409, "File bytes do not match the original selection."); }
    const after = await target(before.actor, collectionId, documentId); if ("response" in after) return after.response;
    if (JSON.stringify(before.target) !== JSON.stringify(after.target)) return benefitsFailure(409, "Upload changed during verification.");
    const object = after.target.object!;
    const attested = await after.actor.admin.rpc("benefits_document_attest" as never, { p_document_id: documentId, p_sha256: doc.sha256, p_size_bytes: bytes.length, p_mime_type: doc.mime_type, p_object_id: object.id, p_object_version: object.version, p_etag: object.etag } as never);
    if (attested.error) return failure(attested.error);
  }
  const current = await revalidateFamily(before.actor); if ("response" in current) return current.response;
  const result = await rpc(current.actor, "benefits_family_command", { p_collection_id: collectionId, p_action: "finalize", p_payload: { document_id: documentId }, p_expected_revision: parsed.data.expected_revision, p_request_id: parsed.data.request_id });
  if (result.error) return failure(result.error);
  const reply = replySchema.safeParse(result.data);
  return reply.success && reply.data.collection_id === collectionId && reply.data.document.id === documentId ? NextResponse.json(publicUploadReply(reply.data, null), { headers: noStore }) : benefitsFailure();
}
