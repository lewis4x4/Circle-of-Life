import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";

import {
  requireCurrentApiActor,
  revalidateCurrentApiActor,
  type CurrentApiActor,
  type CurrentApiActorResult,
} from "@/lib/auth/current-api-actor";
import { logError } from "@/lib/observability/logger";
import {
  finalizeResidentIntakeSourceBodySchema,
  intakeMimeSchema,
  mapResidentIntakeRpcError,
  prepareResidentIntakeSourceBodySchema,
  RESIDENT_INTAKE_BUCKET,
  RESIDENT_INTAKE_MAX_SOURCE_BYTES,
  recordRevisionSchema,
  residentIntakeSourceRowSchema,
} from "./schemas";

export const RESIDENT_INTAKE_VIEW_ROLES = ["owner", "org_admin", "facility_admin", "nurse"] as const;

const storageObjectSchema = z.object({
  id: z.string().min(1),
  version: z.string().min(1),
  etag: z.string().regex(/^[0-9a-f]{32,64}$/i),
  size_bytes: z.number().int().nonnegative(),
  mime: intakeMimeSchema,
  owner_id: z.string().min(1),
}).strict();

const sourceTargetSchema = z.object({
  source_id: z.string(),
  bucket: z.literal(RESIDENT_INTAKE_BUCKET),
  path: z.string().min(1).max(1_024),
  declared_mime: intakeMimeSchema,
  declared_size_bytes: z.number().int().positive().max(RESIDENT_INTAKE_MAX_SOURCE_BYTES),
  declared_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  state: z.string().min(1).max(80),
  revision: z.string(),
  object: storageObjectSchema.nullable(),
}).strict();

export type ResidentIntakeSourceTarget = z.infer<typeof sourceTargetSchema>;

export class ResidentIntakeByteError extends Error {
  constructor(
    readonly outcome: "validation" | "missing" | "conflict" | "retryable",
    message: string,
  ) {
    super(message);
    this.name = "ResidentIntakeByteError";
  }
}

function contentType(value: string) {
  return value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function hasIsoBrand(bytes: Uint8Array, allowed: readonly string[]) {
  if (bytes.byteLength < 12 || Buffer.from(bytes.subarray(4, 8)).toString("ascii") !== "ftyp") return false;
  const brands = Buffer.from(bytes.subarray(8, Math.min(bytes.byteLength, 40))).toString("ascii");
  return allowed.some((brand) => brands.includes(brand));
}

export function sniffResidentIntakeMime(bytes: Uint8Array): (typeof intakeMimeSchema)["_output"] | null {
  if (bytes.byteLength >= 5 && Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-") return "application/pdf";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.byteLength >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP") return "image/webp";
  if (hasIsoBrand(bytes, ["heic", "heix", "hevc", "hevx", "heim", "heis"])) return "image/heic";
  if (hasIsoBrand(bytes, ["mif1", "msf1"])) return "image/heif";
  return null;
}

export function validateResidentIntakeBytes(
  bytes: Uint8Array,
  declaredMime: string,
  declaredSize: number,
  declaredSha256: string,
) {
  if (declaredSize < 1 || declaredSize > RESIDENT_INTAKE_MAX_SOURCE_BYTES || bytes.byteLength !== declaredSize) {
    throw new ResidentIntakeByteError("conflict", "Uploaded source size does not match its declaration");
  }
  const mime = sniffResidentIntakeMime(bytes);
  if (!mime || mime !== contentType(declaredMime)) {
    throw new ResidentIntakeByteError("conflict", "Uploaded source format does not match its declaration");
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expected = Buffer.from(declaredSha256.toLowerCase(), "hex");
  const actual = Buffer.from(sha256, "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new ResidentIntakeByteError("conflict", "Uploaded source checksum does not match its declaration");
  }
  return { mime, sha256, md5: createHash("md5").update(bytes).digest("hex") };
}

function safeFailure(status: number, outcome: string, error: string) {
  return NextResponse.json({ error, outcome }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function requireResidentIntakeActor(): Promise<CurrentApiActorResult> {
  return requireCurrentApiActor({
    allowedRoles: RESIDENT_INTAKE_VIEW_ROLES,
    scope: "resident-intake.current-actor",
  });
}

export async function revalidateResidentIntakeActor(actor: CurrentApiActor): Promise<CurrentApiActorResult> {
  const result = await revalidateCurrentApiActor(actor, {
    allowedRoles: RESIDENT_INTAKE_VIEW_ROLES,
    scope: "resident-intake.current-actor.revalidate",
  });
  if ("response" in result) return result;
  if (result.actor.id !== actor.id || result.actor.organizationId !== actor.organizationId || result.actor.appRole !== actor.appRole) {
    return { response: safeFailure(404, "missing", "Resident intake not found") };
  }
  return result;
}

export async function readResidentIntakeSourceTarget(actor: CurrentApiActor, intakeId: string, sourceId: string) {
  const { data, error } = await actor.client.rpc(
    "resident_record_intake_source_target" as never,
    { p_intake_id: intakeId, p_source_id: sourceId } as never,
  );
  if (error) return { error } as const;
  const parsed = sourceTargetSchema.safeParse(data);
  if (!parsed.success || parsed.data.source_id !== sourceId) {
    return { error: { code: "P0002", message: "Source target unavailable" } } as const;
  }
  if (!parsed.data.path.includes(`/${intakeId}/${sourceId}/`) && !parsed.data.path.startsWith(`${intakeId}/${sourceId}/`)) {
    return { error: { code: "P0002", message: "Source target unavailable" } } as const;
  }
  return { target: parsed.data } as const;
}

function sameTarget(before: ResidentIntakeSourceTarget, after: ResidentIntakeSourceTarget) {
  return JSON.stringify(before) === JSON.stringify(after);
}

export async function downloadVerifiedResidentIntakeSource(
  actor: CurrentApiActor,
  intakeId: string,
  sourceId: string,
  requireFinalized = true,
): Promise<{ actor: CurrentApiActor; target: ResidentIntakeSourceTarget; bytes: Uint8Array } | { response: NextResponse }> {
  let live = await revalidateResidentIntakeActor(actor);
  if ("response" in live) return live;
  const beforeResult = await readResidentIntakeSourceTarget(live.actor, intakeId, sourceId);
  if ("error" in beforeResult || (requireFinalized && !["finalized", "ready_to_parse", "review", "quarantined", "promoted", "excluded", "failed"].includes(beforeResult.target.state))) {
    return { response: safeFailure(404, "missing", "Resident intake source not found") };
  }
  const before = beforeResult.target;
  const downloaded = await live.actor.client.storage.from(RESIDENT_INTAKE_BUCKET).download(before.path);
  if (downloaded.error || !downloaded.data) {
    if (downloaded.error) logError("resident-intake.source.download", downloaded.error, { intakeId, sourceId });
    return { response: safeFailure(404, "missing", "Resident intake source not found") };
  }
  try {
    const bytes = new Uint8Array(await downloaded.data.arrayBuffer());
    validateResidentIntakeBytes(bytes, before.declared_mime, before.declared_size_bytes, before.declared_sha256);
    live = await revalidateResidentIntakeActor(live.actor);
    if ("response" in live) return live;
    const afterResult = await readResidentIntakeSourceTarget(live.actor, intakeId, sourceId);
    if ("error" in afterResult || !sameTarget(before, afterResult.target)) {
      return { response: safeFailure(409, "conflict", "Resident intake source changed; refresh before retrying") };
    }
    return { actor: live.actor, target: afterResult.target, bytes };
  } catch (error) {
    if (error instanceof ResidentIntakeByteError) return { response: safeFailure(409, error.outcome, error.message) };
    logError("resident-intake.source.verify", error, { intakeId, sourceId });
    return { response: safeFailure(503, "retryable", "Resident intake source could not be verified; retry with the same request key") };
  }
}

export async function prepareResidentIntakeSource(request: Request, intakeId: string) {
  const auth = await requireResidentIntakeActor();
  if ("response" in auth) return auth.response;
  const body = prepareResidentIntakeSourceBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return safeFailure(400, "validation", "Provide valid source metadata, checksum, revision, and request key");
  const live = await revalidateResidentIntakeActor(auth.actor);
  if ("response" in live) return live.response;
  const { request_key, expected_revision, ...payload } = body.data;
  const { data, error } = await live.actor.client.rpc(
    "prepare_resident_record_intake_source" as never,
    {
      p_intake_id: intakeId,
      p_request_key: request_key,
      p_payload: {
        title: payload.file_name,
        original_filename: payload.file_name,
        declared_mime: payload.declared_mime,
        declared_size_bytes: payload.declared_size_bytes,
        declared_sha256: payload.declared_sha256,
        ...(payload.source_order ? { source_order: payload.source_order } : {}),
        expected_intake_revision: expected_revision,
      },
    } as never,
  );
  if (error) {
    logError("resident-intake.source.prepare", error, { intakeId });
    const mapped = mapResidentIntakeRpcError(error, "prepare");
    return safeFailure(mapped.status, mapped.outcome, mapped.error);
  }
  const result = z.object({ source: residentIntakeSourceRowSchema, intake_revision: recordRevisionSchema, replayed: z.boolean().optional() }).passthrough().safeParse(data);
  if (!result.success || result.data.source.intake_id !== intakeId) {
    return safeFailure(503, "uncertain", "Resident intake source preparation could not be confirmed; re-read before retrying");
  }
  const current = await revalidateResidentIntakeActor(live.actor);
  if ("response" in current) return current.response;
  const fresh = await readResidentIntakeSourceTarget(current.actor, intakeId, result.data.source.id);
  if ("error" in fresh) return safeFailure(404, "missing", "Resident intake source not found");
  const upload = fresh.target.state === "prepared"
    ? await current.actor.client.storage.from(RESIDENT_INTAKE_BUCKET).createSignedUploadUrl(fresh.target.path)
    : { data: null, error: null };
  if (fresh.target.state === "prepared" && (upload.error || !upload.data)) {
    if (upload.error) logError("resident-intake.source.signed-upload", upload.error, { intakeId, sourceId: result.data.source.id });
    return NextResponse.json({ source: result.data.source, intake_revision: result.data.intake_revision, replayed: result.data.replayed ?? false, upload: null, upload_error: "Upload URL unavailable; retry with the same request key" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
  return NextResponse.json({
    source: result.data.source,
    intake_revision: result.data.intake_revision,
    replayed: result.data.replayed ?? false,
    upload: upload.data ? { path: upload.data.path ?? fresh.target.path, token: upload.data.token, signedUrl: upload.data.signedUrl } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function finalizeResidentIntakeSource(request: Request, intakeId: string, sourceId: string) {
  const auth = await requireResidentIntakeActor();
  if ("response" in auth) return auth.response;
  const body = finalizeResidentIntakeSourceBodySchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return safeFailure(400, "validation", "Provide a valid revision and request key");
  let live = await revalidateResidentIntakeActor(auth.actor);
  if ("response" in live) return live.response;
  const loaded = await downloadVerifiedResidentIntakeSource(live.actor, intakeId, sourceId, false);
  if ("response" in loaded) return loaded.response;
  live = { actor: loaded.actor };
  const target = loaded.target;
  const hashes = validateResidentIntakeBytes(loaded.bytes, target.declared_mime, target.declared_size_bytes, target.declared_sha256);
  const storedObject = target.object;
  if (!storedObject) {
    return safeFailure(503, "retryable", "Stored source identity could not be confirmed; retry with the same request key");
  }
  const storedMime = contentType(storedObject.mime);
  const storedEtag = storedObject.etag.toLowerCase();
  if (storedObject.owner_id !== live.actor.id || storedObject.size_bytes !== loaded.bytes.byteLength || storedMime !== hashes.mime || storedEtag !== hashes.md5) {
    return safeFailure(409, "conflict", "Stored source identity does not match the uploaded bytes");
  }
  const attestation = await live.actor.admin.rpc(
    "attest_resident_record_intake_bytes" as never,
    {
      p_source_id: sourceId,
      p_object_id: storedObject.id,
      p_object_version: storedObject.version,
      p_etag: storedEtag,
      p_size: loaded.bytes.byteLength,
      p_mime: hashes.mime,
      p_sha256: hashes.sha256,
      p_md5: hashes.md5,
      p_uploader: live.actor.id,
    } as never,
  );
  if (attestation.error) {
    logError("resident-intake.source.attest", attestation.error, { intakeId, sourceId });
    return safeFailure(503, "retryable", "Resident intake source verification could not be confirmed; retry with the same request key");
  }
  const current = await revalidateResidentIntakeActor(live.actor);
  if ("response" in current) return current.response;
  const { data, error } = await current.actor.client.rpc(
    "finalize_resident_record_intake_source" as never,
    { p_intake_id: intakeId, p_source_id: sourceId, p_request_key: body.data.request_key, p_expected_revision: body.data.expected_revision } as never,
  );
  if (error) {
    logError("resident-intake.source.finalize", error, { intakeId, sourceId });
    const mapped = mapResidentIntakeRpcError(error, "finalize");
    return safeFailure(mapped.status, mapped.outcome, mapped.error);
  }
  const result = z.object({ source: residentIntakeSourceRowSchema, replayed: z.boolean().optional() }).passthrough().safeParse(data);
  if (!result.success || result.data.source.id !== sourceId || result.data.source.intake_id !== intakeId || result.data.source.state !== "finalized") {
    return safeFailure(503, "uncertain", "Resident intake source finalization could not be confirmed; re-read before retrying");
  }
  return NextResponse.json({ source: result.data.source, replayed: result.data.replayed ?? false }, { headers: { "Cache-Control": "no-store" } });
}

export async function downloadResidentIntakeSource(intakeId: string, sourceId: string) {
  const auth = await requireResidentIntakeActor();
  if ("response" in auth) return auth.response;
  const loaded = await downloadVerifiedResidentIntakeSource(auth.actor, intakeId, sourceId);
  if ("response" in loaded) return loaded.response;
  const extension: Record<string, string> = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "image/heif": "heif" };
  const body = loaded.bytes.buffer.slice(
    loaded.bytes.byteOffset,
    loaded.bytes.byteOffset + loaded.bytes.byteLength,
  ) as ArrayBuffer;
  return new NextResponse(body, {
    headers: {
      "Content-Type": loaded.target.declared_mime,
      "Content-Length": String(loaded.bytes.byteLength),
      "Content-Disposition": `attachment; filename="resident-intake-source-${sourceId}.${extension[loaded.target.declared_mime] ?? "bin"}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
