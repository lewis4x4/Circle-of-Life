import { createHash } from "node:crypto";
import { z } from "zod";
import { databaseUuidSchema } from "@/lib/operations/database-uuid";
import { BENEFITS_STAGES, type BenefitsDetail, type BenefitsDocument } from "./contracts";

// Leave room for the cover/checklist/manifest below Netlify's 20 MB streamed response limit.
export const MAX_PACKET_BYTES = 18 * 1024 * 1024;
export const packetRequestSchema = z.object({
  document_ids: z.array(databaseUuidSchema).min(1).max(25).refine((ids) => new Set(ids).size === ids.length, "Select each document once"),
  expected_revision: z.number().int().min(1),
}).strict();

export class BenefitsPacketError extends Error {}

/** Selection is deliberately independent of download/storage authority, checked by the route. */
export function selectPacketDocuments(detail: BenefitsDetail, documentIds: string[]): BenefitsDocument[] {
  if (!documentIds.length || documentIds.length > 25 || new Set(documentIds).size !== documentIds.length) {
    throw new BenefitsPacketError("Select between 1 and 25 distinct reviewed documents.");
  }
  const documents = documentIds.map((id) => {
    const document = detail.documents.find((item) => item.id === id && item.case_id === detail.case.id);
    const reviews = detail.requirements.filter((item) => item.case_id === detail.case.id && item.document_id === id);
    const accepted = reviews.some((review) => review.status === "accepted" && review.reviewed_by && review.reviewed_at && review.signature_status !== "pending");
    if (!document || document.status !== "ready" || document.voided_at || !accepted || reviews.some((review) => review.status === "rejected" || review.signature_status === "pending")) {
      throw new BenefitsPacketError("Every selected document must belong to this case and have an accepted review with signatures resolved.");
    }
    return document;
  });
  if (documents.reduce((sum, doc) => sum + doc.size_bytes, 0) > MAX_PACKET_BYTES) {
    throw new BenefitsPacketError("Selected documents exceed the 18 MiB packet limit. Export smaller selections.");
  }
  return documents;
}

// Helvetica/Courier base PDF fonts cannot represent every Unicode character. The
// UTF-8 manifest retains exact names; the PDF explicitly identifies its fallback.
function pdfText(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[\u2010-\u2015]/g, "-").replace(/[\u2018\u2019]/g, "'").replace(/[\u201c\u201d]/g, '"').replace(/[^\x20-\x7e]/g, "?");
}

function wrap(value: string): string[] {
  let text = pdfText(value);
  const lines: string[] = [];
  while (text.length > 88) {
    const space = text.lastIndexOf(" ", 88);
    const end = space > 0 ? space : 88;
    lines.push(text.slice(0, end));
    text = text.slice(end).trimStart();
  }
  if (text) lines.push(text);
  return lines.length ? lines : [""];
}

/** Minimal paginated PDF using an embedded text stream, with byte-accurate xrefs. */
export function buildBenefitsCoverPdf(lines: string[]): Buffer {
  const rows = lines.flatMap(wrap);
  const pages: string[][] = [];
  for (let start = 0; start < rows.length; start += 45) pages.push(rows.slice(start, start + 45));
  if (!pages.length) pages.push([]);
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Courier >>"];
  const pageIds: number[] = [];
  pages.forEach((page, index) => {
    const pageId = objects.length + 1;
    pageIds.push(pageId);
    const escape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
    const stream = ["BT /F1 11 Tf 42 750 Td (HAVEN | Medicaid & Benefits) Tj", "/F1 9 Tf 0 -28 Td 14 TL", ...page.map((line) => `(${escape(line)}) Tj T*`), "ET", `BT /F1 8 Tf 42 30 Td (Private benefits case | Page ${index + 1} of ${pages.length}) Tj ET`].join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`);
  });
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** ZIP store method: preserves signed source bytes, does not recompress or rewrite PDFs. */
function zipStored(files: Array<{ name: string; bytes: Uint8Array }>): Buffer {
  const local: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    const name = Buffer.from(file.name, "utf8"), data = Buffer.from(file.bytes), crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6);
    header.writeUInt16LE(33, 12); // 1980-01-01; authoritative dates are in the manifest.
    header.writeUInt32LE(crc, 14); header.writeUInt32LE(data.length, 18); header.writeUInt32LE(data.length, 22); header.writeUInt16LE(name.length, 26);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50); directory.writeUInt16LE(20, 4); directory.writeUInt16LE(20, 6); directory.writeUInt16LE(0x800, 8);
    directory.writeUInt16LE(33, 14); directory.writeUInt32LE(crc, 16); directory.writeUInt32LE(data.length, 20); directory.writeUInt32LE(data.length, 24); directory.writeUInt16LE(name.length, 28); directory.writeUInt32LE(offset, 42);
    local.push(header, name, data); central.push(directory, name); offset += header.length + name.length + data.length;
  }
  const directoryBytes = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(directoryBytes.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directoryBytes, end]);
}

export function buildBenefitsPacket(detail: BenefitsDetail, documentIds: string[], verifiedBytes: ReadonlyMap<string, Uint8Array>, generatedAt: string): Buffer {
  const documents = selectPacketDocuments(detail, documentIds);
  const selected = new Set(documentIds);
  const checklist = detail.requirements.map((requirement) => {
    const accepted = requirement.status === "accepted" && requirement.reviewed_by && requirement.reviewed_at && requirement.signature_status !== "pending" && requirement.document_id && selected.has(requirement.document_id);
    const waived = requirement.status === "not_applicable" && requirement.reviewed_by && requirement.reviewed_at && requirement.review_reason?.trim();
    return { id: requirement.id, document_id: requirement.document_id ?? null, title: requirement.title, stage: requirement.stage, status: requirement.status, included: !!(requirement.document_id && selected.has(requirement.document_id)), satisfied_in_export: !!(accepted || waived), review_reason: requirement.review_reason ?? null, reviewed_by: requirement.reviewed_by, reviewed_at: requirement.reviewed_at, signature_status: requirement.signature_status };
  });
  const readiness = BENEFITS_STAGES.map((stage) => {
    const requirements = checklist.filter((item) => item.stage === stage);
    return { stage, status: requirements.length === 0 ? "requirements_not_defined" : requirements.every((item) => item.satisfied_in_export) ? "checklist_satisfied" : "incomplete", missing_requirement_ids: requirements.filter((item) => !item.satisfied_in_export).map((item) => item.id) };
  });
  const files = documents.map((document, index) => {
    const bytes = verifiedBytes.get(document.id);
    if (!bytes || bytes.length !== document.size_bytes || createHash("sha256").update(bytes).digest("hex") !== document.sha256) throw new BenefitsPacketError("Document bytes do not match the immutable evidence record.");
    const extension = ({ "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg" } as Record<string, string>)[document.mime_type];
    if (!extension) throw new BenefitsPacketError("Unsupported document format.");
    return { name: `documents/${String(index + 1).padStart(2, "0")}.${extension}`, bytes };
  });
  const manifest = {
    format: "haven-benefits-packet-v1", generated_at: generatedAt,
    case: { id: detail.case.id, revision: detail.case.revision, resident_id: detail.case.resident_id, resident_name: detail.case.resident_name, facility_name: detail.case.facility_name, program: detail.case.program },
    purpose: "Staff-assembled export. Does not record submission, receipt, signature, eligibility or funding approval.",
    source_context: "Jessica workflow discussion 2026-09-16; New Admits Medicaid Pending Criteria; forms packet; Grande Cypress MCD master packet. References inform staff collection; current agency acceptance is not asserted. No source-template signatures or preset resident facts are copied.",
    pdf_text_note: "PDF uses ASCII approximations; exact Unicode names and titles remain in this UTF-8 manifest.",
    stage_checklists: readiness, requirements: checklist,
    documents: documents.map((document, index) => ({ id: document.id, archive_path: files[index].name, filename: document.filename, mime_type: document.mime_type, size_bytes: document.size_bytes, sha256: document.sha256, document_type: document.document_type, template_version: document.template_version, uploaded_at: document.created_at })),
  };
  const lines = [
    "PRIVATE CASE COVER SHEET / DOCUMENT CHECKLIST", "",
    `Resident: ${detail.case.resident_name}`, `Facility: ${detail.case.facility_name}`, `Program: ${detail.case.program}`,
    `Case: ${detail.case.id} | Revision: ${detail.case.revision}`, `Generated: ${generatedAt}`, "",
    manifest.purpose, "Review the selected files and destination before any external submission.", "A checklist result is not agency acceptance or an eligibility decision.", "No legal notice is automatically generated or issued by this export.", manifest.pdf_text_note, "",
    "STAGE CHECKLISTS", ...readiness.map((item) => `${item.stage}: ${item.status.replace(/_/g, " ")}`), "",
    "REQUIREMENTS", ...checklist.flatMap((item) => [`[${item.satisfied_in_export ? "OK" : "OPEN"}] ${item.stage}: ${item.title}`, `  Status: ${item.status}; signature: ${item.signature_status}; selected: ${item.included ? "yes" : "no"}`]), "",
    "SELECTED DOCUMENTS", ...documents.flatMap((document, index) => [`${index + 1}. ${document.filename}`, `   Type: ${document.document_type}; template version: ${document.template_version || "not recorded"}`, `   SHA256: ${document.sha256}`]), "",
    "WORKFLOW SOURCE CONTEXT", manifest.source_context,
  ];
  return zipStored([{ name: "cover-and-checklist.pdf", bytes: buildBenefitsCoverPdf(lines) }, { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest, null, 2) + "\n") }, ...files]);
}
