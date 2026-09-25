import { PDFDocument, PDFName, StandardFonts } from "pdf-lib";
import { describe, expect, it } from "vitest";

import {
  countPages,
  cutPdfPages,
  DocumentIntakeByteError,
  sameSha256,
  sha256Hex,
  sniffDocumentIntakeMime,
  sniffMatchesDeclared,
  verifyDeclaredBytes,
} from "./bytes";

function bytesOf(...parts: (number[] | string)[]) {
  return new Uint8Array(Buffer.concat(parts.map((part) => (typeof part === "string" ? Buffer.from(part, "latin1") : Buffer.from(part)))));
}

async function threePagePdf() {
  const doc = await PDFDocument.create();
  doc.setTitle("Resident packet");
  doc.setAuthor("Front desk scanner");
  doc.setSubject("Mixed scan");
  doc.setKeywords(["intake"]);
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const [index, size] of [[1, 300], [2, 400], [3, 500]] as const) {
    const page = doc.addPage([size, size]);
    page.drawText(`Page ${index}`, { x: 20, y: 20, size: 12, font });
  }
  return doc.save();
}

describe("sniffDocumentIntakeMime", () => {
  it("recognizes every accepted format from its leading bytes", () => {
    expect(sniffDocumentIntakeMime(bytesOf("%PDF-1.7\n"))).toBe("application/pdf");
    expect(sniffDocumentIntakeMime(bytesOf([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffDocumentIntakeMime(bytesOf([137, 80, 78, 71, 13, 10, 26, 10, 0]))).toBe("image/png");
    expect(sniffDocumentIntakeMime(bytesOf("RIFF", [0, 0, 0, 0], "WEBPVP8 "))).toBe("image/webp");
    expect(sniffDocumentIntakeMime(bytesOf([0, 0, 0, 24], "ftypheic", [0, 0, 0, 0], "mif1heic"))).toBe("image/heic");
    expect(sniffDocumentIntakeMime(bytesOf([0, 0, 0, 24], "ftypmif1", [0, 0, 0, 0], "mif1"))).toBe("image/heif");
  });

  it("recognizes little- and big-endian TIFF", () => {
    expect(sniffDocumentIntakeMime(bytesOf("II", [0x2a, 0x00, 8, 0, 0, 0]))).toBe("image/tiff");
    expect(sniffDocumentIntakeMime(bytesOf("MM", [0x00, 0x2a, 0, 0, 0, 8]))).toBe("image/tiff");
  });

  it("refuses anything else", () => {
    expect(sniffDocumentIntakeMime(bytesOf("<html><script>"))).toBeNull();
    expect(sniffDocumentIntakeMime(bytesOf("II", [0x2b, 0x00]))).toBeNull();
    expect(sniffDocumentIntakeMime(new Uint8Array())).toBeNull();
  });

  it("treats HEIC and HEIF brands as interchangeable, nothing else", () => {
    expect(sniffMatchesDeclared("image/heif", "image/heic")).toBe(true);
    expect(sniffMatchesDeclared("image/heic", "image/heif")).toBe(true);
    expect(sniffMatchesDeclared("image/tiff", "image/tiff")).toBe(true);
    expect(sniffMatchesDeclared("image/png", "image/jpeg")).toBe(false);
    expect(sniffMatchesDeclared(null, "application/pdf")).toBe(false);
  });
});

describe("verifyDeclaredBytes", () => {
  const pdf = bytesOf("%PDF-1.7\nfixture");
  const sha = sha256Hex(pdf);

  it("accepts matching size, checksum and format", () => {
    expect(verifyDeclaredBytes(pdf, { mime: "application/pdf", size: pdf.byteLength, sha256: sha })).toEqual({ sha256: sha, sniffed: "application/pdf" });
  });

  it("refuses a format that does not match the declaration", () => {
    expect(() => verifyDeclaredBytes(pdf, { mime: "image/png", size: pdf.byteLength, sha256: sha })).toThrow(/format/);
  });

  it("refuses a checksum or size mismatch", () => {
    expect(() => verifyDeclaredBytes(pdf, { mime: "application/pdf", size: pdf.byteLength, sha256: "0".repeat(64) })).toThrow(/checksum/);
    expect(() => verifyDeclaredBytes(pdf, { mime: "application/pdf", size: pdf.byteLength + 1, sha256: sha })).toThrow(/size/);
  });

  it("compares checksums case-insensitively and rejects malformed ones", () => {
    expect(sameSha256(sha, sha.toUpperCase())).toBe(true);
    expect(sameSha256(sha, "0".repeat(64))).toBe(false);
    expect(sameSha256(sha, "not-a-hash")).toBe(false);
    expect(sameSha256(null, sha)).toBe(false);
  });
});

describe("PDF pages", () => {
  it("counts PDF pages and treats images as one page", async () => {
    expect(await countPages(await threePagePdf(), "application/pdf")).toBe(3);
    expect(await countPages(bytesOf([0xff, 0xd8, 0xff]), "image/jpeg")).toBe(1);
  });

  it("refuses an encrypted PDF as unsupported", async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    doc.context.trailerInfo.Encrypt = doc.context.obj({ Filter: PDFName.of("Standard") });
    const encrypted = await doc.save();
    await expect(countPages(encrypted, "application/pdf")).rejects.toMatchObject({ outcome: "unsupported", message: expect.stringMatching(/encrypted/) });
  });

  it("refuses an unreadable PDF as unsupported", async () => {
    await expect(countPages(bytesOf("%PDF-1.7 truncated"), "application/pdf")).rejects.toBeInstanceOf(DocumentIntakeByteError);
  });

  it("cuts exactly the named pages, in order, into a new metadata-free PDF", async () => {
    const source = await threePagePdf();
    const cut = await cutPdfPages(source, [3, 1]);

    expect(cut.pageCount).toBe(2);
    expect(cut.size).toBe(cut.bytes.byteLength);
    expect(cut.sha256).toBe(sha256Hex(cut.bytes));
    expect(sha256Hex(cut.bytes)).not.toBe(sha256Hex(source));
    expect(sniffDocumentIntakeMime(cut.bytes)).toBe("application/pdf");

    const reread = await PDFDocument.load(cut.bytes, { updateMetadata: false });
    expect(reread.getPageCount()).toBe(2);
    expect(reread.getPages().map((page) => page.getWidth())).toEqual([500, 300]);
    expect(reread.getTitle()).toBeUndefined();
    expect(reread.getAuthor()).toBeUndefined();
    expect(reread.getSubject()).toBeUndefined();
    expect(reread.getKeywords()).toBeUndefined();
    expect(reread.getProducer()).toBeUndefined();
  });

  it("produces identical bytes for the same pages (a retried split resumes)", async () => {
    const source = await threePagePdf();
    const first = await cutPdfPages(source, [2]);
    const second = await cutPdfPages(await PDFDocument.load(source), [2]);
    expect(second.sha256).toBe(first.sha256);
  });

  it("refuses a page the document does not have", async () => {
    await expect(cutPdfPages(await threePagePdf(), [4])).rejects.toMatchObject({ outcome: "conflict" });
  });
});
