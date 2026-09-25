import {
  DOCUMENT_INTAKE_MAX_SOURCE_BYTES,
  DOCUMENT_INTAKE_MIME_TYPES,
  type DocumentIntakeMime,
} from "@/lib/document-intake/contracts";

export const UPLOAD_LIMITS_COPY = "PDF, JPEG, PNG, WebP, HEIC, HEIF or TIFF, up to 20 MB each.";

export const UPLOAD_ACCEPT = [
  ...DOCUMENT_INTAKE_MIME_TYPES,
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif",
  ".tif",
  ".tiff",
].join(",");

const BY_EXTENSION: Record<string, DocumentIntakeMime> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  tif: "image/tiff",
  tiff: "image/tiff",
};

/** Browsers often leave HEIC/TIFF types blank; the extension decides then. */
export function intakeMime(file: Pick<File, "name" | "type">): DocumentIntakeMime | null {
  const declared = file.type.toLowerCase();
  if ((DOCUMENT_INTAKE_MIME_TYPES as readonly string[]).includes(declared)) return declared as DocumentIntakeMime;
  const ext = file.name.toLowerCase().split(".").pop() ?? "";
  return BY_EXTENSION[ext] ?? null;
}

export function uploadIssue(file: Pick<File, "name" | "type" | "size">, maxBytes: number = DOCUMENT_INTAKE_MAX_SOURCE_BYTES): string | null {
  if (file.size < 1) return "This file is empty.";
  if (file.size > maxBytes) return `This file is larger than ${Math.floor(maxBytes / (1024 * 1024))} MB.`;
  if (!intakeMime(file)) return "This file type is not accepted.";
  if (/[\\/]/.test(file.name) || file.name.trim().length === 0 || file.name.length > 255) return "Rename the file and try again.";
  return null;
}

export function hexDigest(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  return hexDigest(await crypto.subtle.digest("SHA-256", data));
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} bytes`;
}
