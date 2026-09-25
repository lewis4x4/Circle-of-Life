import { describe, expect, it } from "vitest";

import { hexDigest, intakeMime, sha256Hex, uploadIssue } from "./upload";

describe("upload helpers", () => {
  it("computes the lowercase hex SHA-256 the API expects", async () => {
    const bytes = new TextEncoder().encode("abc");
    const hash = await sha256Hex(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(hash).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hexDigest(new Uint8Array([0, 15, 255]).buffer)).toBe("000fff");
  });

  it("uses the extension when the browser leaves the type blank", () => {
    expect(intakeMime({ name: "IMG_0001.HEIC", type: "" })).toBe("image/heic");
    expect(intakeMime({ name: "scan.tif", type: "" })).toBe("image/tiff");
    expect(intakeMime({ name: "scan.pdf", type: "application/pdf" })).toBe("application/pdf");
    expect(intakeMime({ name: "notes.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" })).toBeNull();
  });

  it("refuses empty, oversized and unsupported files before upload", () => {
    expect(uploadIssue({ name: "a.pdf", type: "application/pdf", size: 0 })).toBe("This file is empty.");
    expect(uploadIssue({ name: "a.pdf", type: "application/pdf", size: 21 * 1024 * 1024 })).toBe("This file is larger than 20 MB.");
    expect(uploadIssue({ name: "a.pdf", type: "application/pdf", size: 6 * 1024 * 1024 }, 5 * 1024 * 1024)).toBe("This file is larger than 5 MB.");
    expect(uploadIssue({ name: "a.zip", type: "application/zip", size: 10 })).toBe("This file type is not accepted.");
    expect(uploadIssue({ name: "a.png", type: "image/png", size: 10 })).toBeNull();
  });
});
