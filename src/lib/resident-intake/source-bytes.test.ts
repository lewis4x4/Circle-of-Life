import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { ResidentIntakeByteError, sniffResidentIntakeMime, validateResidentIntakeBytes } from "./source-bytes";

const bytesFor = {
  pdf: new Uint8Array(Buffer.from("%PDF-1.7\nfixture")),
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 0, 1]),
  png: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0]),
  webp: new Uint8Array(Buffer.from("RIFF\u0000\u0000\u0000\u0000WEBP")),
  heic: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 104, 101, 105, 99]),
  heif: new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 109, 105, 102, 49]),
};

describe("resident intake source byte validation", () => {
  it.each([
    ["application/pdf", bytesFor.pdf],
    ["image/jpeg", bytesFor.jpeg],
    ["image/png", bytesFor.png],
    ["image/webp", bytesFor.webp],
    ["image/heic", bytesFor.heic],
    ["image/heif", bytesFor.heif],
  ])("recognizes %s by magic", (mime, bytes) => {
    expect(sniffResidentIntakeMime(bytes)).toBe(mime);
  });

  it("verifies SHA-256 and returns storage attestation hashes", () => {
    const bytes = bytesFor.pdf;
    const sha = createHash("sha256").update(bytes).digest("hex");
    expect(validateResidentIntakeBytes(bytes, "application/pdf", bytes.length, sha)).toEqual({
      mime: "application/pdf",
      sha256: sha,
      md5: createHash("md5").update(bytes).digest("hex"),
    });
  });

  it("rejects bad magic, oversize declarations, and checksum mismatches", () => {
    const sha = createHash("sha256").update(bytesFor.pdf).digest("hex");
    expect(() => validateResidentIntakeBytes(bytesFor.pdf, "image/png", bytesFor.pdf.length, sha)).toThrow(ResidentIntakeByteError);
    expect(() => validateResidentIntakeBytes(bytesFor.pdf, "application/pdf", 20 * 1024 * 1024 + 1, sha)).toThrow("size");
    expect(() => validateResidentIntakeBytes(bytesFor.pdf, "application/pdf", bytesFor.pdf.length, "0".repeat(64))).toThrow("checksum");
  });
});
