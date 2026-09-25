/**
 * Document Intake — byte handling on the server (COL-771, DI-02 / DI-05).
 *
 * Sniffing, checksums, PDF page counting and page cutting. Nothing here logs
 * or returns file contents; errors carry an outcome and a plain message only.
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { PDFDocument, PDFName } from "pdf-lib";

import { DOCUMENT_INTAKE_MAX_SOURCE_BYTES, type DocumentIntakeMime } from "../contracts";

export class DocumentIntakeByteError extends Error {
  constructor(
    readonly outcome: "conflict" | "unsupported" | "missing",
    message: string,
    /** Stable reason code recorded when an upload is rejected (never file content). */
    readonly code: string = outcome,
  ) {
    super(message);
    this.name = "DocumentIntakeByteError";
  }
}

const HEIF_FAMILY = new Set<string>(["image/heic", "image/heif"]);

function ascii(bytes: Uint8Array, start: number, end: number) {
  return Buffer.from(bytes.subarray(start, end)).toString("latin1");
}

function hasIsoBrand(bytes: Uint8Array, allowed: readonly string[]) {
  if (bytes.byteLength < 12 || ascii(bytes, 4, 8) !== "ftyp") return false;
  const brands = ascii(bytes, 8, Math.min(bytes.byteLength, 40));
  return allowed.some((brand) => brands.includes(brand));
}

/** The format the bytes actually are, or null when it is not an accepted type. */
export function sniffDocumentIntakeMime(bytes: Uint8Array): DocumentIntakeMime | null {
  if (bytes.byteLength >= 5 && ascii(bytes, 0, 5) === "%PDF-") return "application/pdf";
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.byteLength >= 8 && Buffer.from(bytes.subarray(0, 8)).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (bytes.byteLength >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return "image/webp";
  if (bytes.byteLength >= 4 && ((bytes[0] === 0x49 && bytes[1] === 0x49 && bytes[2] === 0x2a && bytes[3] === 0x00)
    || (bytes[0] === 0x4d && bytes[1] === 0x4d && bytes[2] === 0x00 && bytes[3] === 0x2a))) return "image/tiff";
  if (hasIsoBrand(bytes, ["heic", "heix", "hevc", "hevx", "heim", "heis"])) return "image/heic";
  if (hasIsoBrand(bytes, ["mif1", "msf1"])) return "image/heif";
  return null;
}

/** HEIC and HEIF brands are interchangeable in the wild; either satisfies either declaration. */
export function sniffMatchesDeclared(sniffed: string | null, declared: string) {
  if (!sniffed) return false;
  const want = declared.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return sniffed === want || (HEIF_FAMILY.has(sniffed) && HEIF_FAMILY.has(want));
}

export function sha256Hex(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function sameSha256(a: string | null | undefined, b: string | null | undefined) {
  if (!a || !b || !/^[0-9a-f]{64}$/i.test(a) || !/^[0-9a-f]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), "hex"), Buffer.from(b.toLowerCase(), "hex"));
}

/** Size, checksum and format must all match what the uploader declared. */
export function verifyDeclaredBytes(
  bytes: Uint8Array,
  declared: { mime: string; size: number; sha256: string },
) {
  if (bytes.byteLength < 1 || bytes.byteLength > DOCUMENT_INTAKE_MAX_SOURCE_BYTES || bytes.byteLength !== declared.size) {
    throw new DocumentIntakeByteError("conflict", "The uploaded file size does not match what was declared", "size_mismatch");
  }
  const sha256 = sha256Hex(bytes);
  if (!sameSha256(sha256, declared.sha256)) {
    throw new DocumentIntakeByteError("conflict", "The uploaded file checksum does not match what was declared", "checksum_mismatch");
  }
  const sniffed = sniffDocumentIntakeMime(bytes);
  if (!sniffMatchesDeclared(sniffed, declared.mime)) {
    throw new DocumentIntakeByteError("conflict", "The uploaded file format does not match what was declared", "format_mismatch");
  }
  return { sha256, sniffed: sniffed as DocumentIntakeMime };
}

async function loadPdf(bytes: Uint8Array) {
  let pdf: PDFDocument;
  try {
    // pdf-lib's EncryptedPDFError does not survive instanceof, so load and ask.
    pdf = await PDFDocument.load(bytes, { updateMetadata: false, ignoreEncryption: true });
    pdf.getPageCount();
  } catch {
    throw new DocumentIntakeByteError("unsupported", "This PDF could not be read", "unreadable_pdf");
  }
  if (pdf.isEncrypted) {
    throw new DocumentIntakeByteError("unsupported", "This PDF is password-protected or encrypted; save an unprotected copy and upload that", "encrypted_pdf");
  }
  return pdf;
}

/** PDFs report their page count; every accepted image is one page. */
export async function countPages(bytes: Uint8Array, mime: string) {
  if (mime !== "application/pdf") return 1;
  const pdf = await loadPdf(bytes);
  const count = pdf.getPageCount();
  if (count < 1) throw new DocumentIntakeByteError("unsupported", "This PDF has no pages", "empty_pdf");
  return count;
}

/**
 * A new PDF holding exactly `pages` (1-based, in the given order) of the source.
 * Only page content is carried over: no document info (title, author, subject,
 * keywords, producer, dates), no open action and no page-level actions. The
 * output is deterministic for the same source and pages, which lets a retried
 * split re-derive the identical child bytes.
 */
export async function cutPdfPages(source: Uint8Array | PDFDocument, pages: readonly number[]) {
  const src = source instanceof PDFDocument ? source : await loadPdf(source);
  const total = src.getPageCount();
  if (pages.length < 1 || pages.some((page) => !Number.isInteger(page) || page < 1 || page > total)) {
    throw new DocumentIntakeByteError("conflict", "A split part names a page the document does not have");
  }
  const out = await PDFDocument.create({ updateMetadata: false });
  const copied = await out.copyPages(src, pages.map((page) => page - 1));
  for (const page of copied) {
    page.node.delete(PDFName.of("AA"));
    out.addPage(page);
  }
  const bytes = await out.save({ updateFieldAppearances: false });
  return { bytes, sha256: sha256Hex(bytes), size: bytes.byteLength, pageCount: copied.length };
}

export function loadPdfForSplit(bytes: Uint8Array) {
  return loadPdf(bytes);
}

const EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/tiff": "tif",
};

export function extensionForMime(mime: string) {
  return EXTENSIONS[mime] ?? "bin";
}

/** Formats a browser cannot show natively; previewed as PNG, original untouched. */
export function needsPreviewConversion(mime: string) {
  return mime === "image/heic" || mime === "image/heif" || mime === "image/tiff" || mime === "image/webp";
}
