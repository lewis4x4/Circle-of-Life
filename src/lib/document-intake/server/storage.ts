import type { CurrentApiActor } from "@/lib/auth/current-api-actor";
import { DOCUMENT_INTAKE_BUCKET } from "../contracts";
import { DocumentIntakeByteError, sameSha256, sha256Hex } from "./bytes";

type Admin = CurrentApiActor["admin"];
type StorageFailure = { message?: string; status?: number; statusCode?: string | number } | null | undefined;

/** Server-only columns of an item; the RPC JSON never carries storage_path. */
export type IntakeItemStorage = {
  id: string;
  organization_id: string;
  facility_id: string | null;
  status: string;
  channel: string;
  parent_item_id: string | null;
  storage_path: string;
  declared_mime: string;
  declared_size_bytes: number;
  declared_sha256: string;
  verified_mime: string | null;
  verified_sha256: string | null;
  page_count: number | null;
  created_by: string | null;
};

const STORAGE_COLUMNS =
  "id, organization_id, facility_id, status, channel, parent_item_id, storage_path, declared_mime, declared_size_bytes, declared_sha256, verified_mime, verified_sha256, page_count, created_by";

/** RLS decides: is this item visible to the signed-in person? */
export async function isItemVisible(actor: CurrentApiActor, itemId: string) {
  const { data, error } = await actor.client
    .from("document_intake_items" as never)
    .select("id")
    .eq("id", itemId)
    .maybeSingle();
  if (error) return { error } as const;
  return { visible: Boolean(data) } as const;
}

/** Service read of the storage columns, pinned to the actor's organization. */
export async function readItemStorage(actor: CurrentApiActor, itemId: string) {
  const { data, error } = await actor.admin
    .from("document_intake_items" as never)
    .select(STORAGE_COLUMNS)
    .eq("id", itemId)
    .eq("organization_id", actor.organizationId)
    .maybeSingle();
  if (error) return { error } as const;
  return { item: (data as IntakeItemStorage | null) ?? null } as const;
}

function isMissing(error: StorageFailure) {
  const status = Number(error?.statusCode ?? error?.status);
  return status === 404 || /not.?found/i.test(error?.message ?? "");
}

function isAlreadyThere(error: StorageFailure) {
  const status = Number(error?.statusCode ?? error?.status);
  return status === 409 || /already exists|duplicate/i.test(error?.message ?? "");
}

export async function downloadObject(admin: Admin, bucket: string, path: string) {
  const { data, error } = await admin.storage.from(bucket).download(path);
  if (error || !data) {
    if (isMissing(error as StorageFailure)) return { missing: true } as const;
    return { error: error ?? new Error("Download returned no data") } as const;
  }
  return { bytes: new Uint8Array(await data.arrayBuffer()) } as const;
}

/** Download an original from the intake bucket and prove it is the attested bytes. */
export async function downloadVerifiedOriginal(admin: Admin, path: string, expectedSha256: string) {
  const loaded = await downloadObject(admin, DOCUMENT_INTAKE_BUCKET, path);
  if ("missing" in loaded) throw new DocumentIntakeByteError("missing", "The original file is missing from storage");
  if ("error" in loaded) return loaded;
  if (!sameSha256(sha256Hex(loaded.bytes), expectedSha256)) {
    throw new DocumentIntakeByteError("conflict", "The stored original does not match its recorded checksum");
  }
  return loaded;
}

/**
 * Write bytes to a path that must not be overwritten. If an object is already
 * there (a retried request), it is accepted only when its bytes are identical.
 */
export async function uploadOrVerify(admin: Admin, bucket: string, path: string, bytes: Uint8Array, contentType: string) {
  const uploaded = await admin.storage.from(bucket).upload(path, bytes, { contentType, upsert: false });
  if (!uploaded.error) return { stored: "uploaded" } as const;
  if (!isAlreadyThere(uploaded.error as StorageFailure)) return { error: uploaded.error } as const;
  const existing = await downloadObject(admin, bucket, path);
  if ("error" in existing) return existing;
  if ("missing" in existing) return { error: new Error("Stored object vanished during verification") } as const;
  if (!sameSha256(sha256Hex(existing.bytes), sha256Hex(bytes))) {
    throw new DocumentIntakeByteError("conflict", "A different file already exists at the destination");
  }
  return { stored: "already_present" } as const;
}
