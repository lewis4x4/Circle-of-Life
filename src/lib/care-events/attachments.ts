/**
 * Attachments on a care event (spec 07A §2, Appendix A): the photograph the
 * aide takes, the scanned paper form, the physician's faxed orders.
 *
 * The bucket is private and stays private. Nothing here ever produces a public
 * URL; a signed URL lasts five minutes and is made at read time.
 *
 * The limits below are the same ones migration 412 enforces in the database and
 * on the bucket. They live here as well so the aide is told "that file is too
 * big" before a 20 MB upload rather than after it.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

type Client = SupabaseClient<Database>;

export const ATTACHMENT_BUCKET = "incident-photos";

/** Five minutes, matching admin-data's photo signing. Never longer. */
export const ATTACHMENT_URL_TTL_SECONDS = 300;

export const ATTACHMENT_MAX_BYTES = 20 * 1024 * 1024;

export const ATTACHMENT_MAX_PER_INCIDENT = 10;

export const ATTACHMENT_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

/** What a file input should accept: the same list, plus the camera's own types. */
export const ATTACHMENT_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

export type AttachmentKind = "photo" | "scanned_form" | "physician_order" | "other";

export const ATTACHMENT_KINDS: ReadonlyArray<{ value: AttachmentKind; label: string }> = [
  { value: "photo", label: "Photo" },
  { value: "scanned_form", label: "Scanned form" },
  { value: "physician_order", label: "Physician order" },
  { value: "other", label: "Other" },
];

const KIND_LABELS: Record<AttachmentKind, string> = {
  photo: "Photo",
  scanned_form: "Scanned form",
  physician_order: "Physician order",
  other: "Other",
};

export function attachmentKindLabel(kind: string | null | undefined): string {
  if (!kind) return "Other";
  return KIND_LABELS[kind as AttachmentKind] ?? "Other";
}

export function isAttachmentKind(value: unknown): value is AttachmentKind {
  return value === "photo" || value === "scanned_form" || value === "physician_order" || value === "other";
}

/**
 * Checks the one file before it leaves the phone. Returns null when it is fine,
 * or the line to show. `count` is how many are already on the incident.
 */
export function describeAttachmentRejection(file: { type: string; size: number }, count: number): string | null {
  if (count >= ATTACHMENT_MAX_PER_INCIDENT) {
    return `Ten files is the limit for one incident. Remove one before adding another.`;
  }
  // A HEIC straight off an iPhone sometimes arrives with an empty type; the
  // bucket is the backstop, so an unknown type is not rejected here on its own.
  if (file.type && !(ATTACHMENT_MIME_TYPES as readonly string[]).includes(file.type)) {
    return "That file type is not accepted. Use a photo or a PDF.";
  }
  if (file.size > ATTACHMENT_MAX_BYTES) {
    return "That file is larger than 20 MB. Take the photo again at a smaller size.";
  }
  if (file.size === 0) {
    return "That file is empty.";
  }
  return null;
}

function fileExtension(file: File): string {
  const fromName = /\.([a-z0-9]{2,5})$/i.exec(file.name)?.[1]?.toLowerCase();
  if (fromName) return fromName;
  if (file.type === "application/pdf") return "pdf";
  const fromType = /^image\/([a-z0-9]+)$/i.exec(file.type)?.[1]?.toLowerCase();
  return fromType === "jpeg" ? "jpg" : fromType || "jpg";
}

/**
 * Uploads to `<organization_id>/<facility_id>/<care_event_id>/<uuid>.<ext>` and
 * records it. The path shape is the one the storage policies scope on, and
 * `attach_care_event_file` refuses anything else.
 */
export async function uploadCareEventAttachment(
  supabase: Client,
  input: {
    organizationId: string;
    facilityId: string;
    careEventId: string;
    file: File;
    kind: AttachmentKind;
    description?: string | null;
  },
): Promise<string> {
  const path = `${input.organizationId}/${input.facilityId}/${input.careEventId}/${crypto.randomUUID()}.${fileExtension(input.file)}`;
  const upload = await supabase.storage.from(ATTACHMENT_BUCKET).upload(path, input.file, {
    contentType: input.file.type || undefined,
    upsert: false,
  });
  if (upload.error) throw upload.error;

  const recorded = await supabase.rpc("attach_care_event_file", {
    p_care_event_id: input.careEventId,
    p_path: path,
    p_kind: input.kind,
    p_description: input.description?.trim() ? input.description.trim() : null,
  });
  if (recorded.error) {
    // The row is what makes the file findable. An object with no row is
    // invisible to every surface, so take it back out rather than leave it.
    await supabase.storage.from(ATTACHMENT_BUCKET).remove([path]);
    throw recorded.error;
  }
  return path;
}

export type CareEventAttachment = {
  id: string;
  path: string;
  kind: AttachmentKind;
  description: string | null;
  takenAt: string | null;
  takenByName: string | null;
};

export async function fetchCareEventAttachments(supabase: Client, careEventId: string): Promise<CareEventAttachment[]> {
  const result = await supabase
    .from("v_care_event_attachments")
    .select("attachment_id, storage_path, kind, description, taken_at, taken_by_name")
    .eq("care_event_id", careEventId)
    .order("taken_at", { ascending: true });
  if (result.error) throw result.error;
  return (result.data ?? [])
    .filter((row): row is typeof row & { attachment_id: string; storage_path: string } =>
      Boolean(row.attachment_id) && Boolean(row.storage_path),
    )
    .map((row) => ({
      id: row.attachment_id,
      path: row.storage_path,
      kind: isAttachmentKind(row.kind) ? row.kind : "other",
      description: row.description,
      takenAt: row.taken_at,
      takenByName: row.taken_by_name,
    }));
}

/** A five-minute signed URL. A failure becomes `null`, never a public URL. */
export async function signAttachment(supabase: Client, path: string): Promise<string | null> {
  try {
    const signed = await supabase.storage.from(ATTACHMENT_BUCKET).createSignedUrl(path, ATTACHMENT_URL_TTL_SECONDS);
    return signed.error ? null : (signed.data?.signedUrl ?? null);
  } catch {
    return null;
  }
}

export function describeAttachmentError(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  if (/ten files is the limit/i.test(message)) return "Ten files is the limit for one incident.";
  if (/already attached/i.test(message)) return "That file is already attached.";
  if (/unknown attachment kind/i.test(message)) return "Pick what the file is before adding it.";
  if (/file path must be/i.test(message)) return "That file could not be stored. Try again.";
  if (/exceeded the maximum allowed size|Payload too large/i.test(message)) return "That file is larger than 20 MB.";
  if (/mime type|not supported/i.test(message)) return "That file type is not accepted. Use a photo or a PDF.";
  if (/forbidden/i.test(message)) return "That is not yours to add.";
  return "The file did not upload. The event is saved; try the file again.";
}
