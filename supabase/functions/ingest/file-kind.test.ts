import { fileKindFromUpload, verifyFileType } from "./file-kind.ts";

Deno.test("octet-stream Markdown uses the final filename extension", () => {
  const kind = fileKindFromUpload(
    "application/octet-stream",
    "Facilities Information.docx.md",
  );
  if (kind !== "markdown") {
    throw new Error(`Expected markdown, received ${kind}`);
  }
});

Deno.test("generic MIME types fall back to supported filename extensions", () => {
  const cases = [
    ["", "policy.pdf", "pdf"],
    ["application/octet-stream", "policy.docx", "docx"],
    ["text/plain", "roster.csv", "spreadsheet"],
    ["binary/octet-stream", "schedule.xlsx", "spreadsheet"],
    ["text/plain; charset=utf-8", "notes.md", "markdown"],
    ["text/plain", "notes.txt", "text"],
  ] as const;

  for (const [mime, name, expected] of cases) {
    const actual = fileKindFromUpload(mime, name);
    if (actual !== expected) {
      throw new Error(`${name}: expected ${expected}, received ${actual}`);
    }
  }
});

Deno.test("specific MIME types remain authoritative", () => {
  if (fileKindFromUpload("application/pdf", "renamed.txt") !== "pdf") {
    throw new Error("Specific PDF MIME type was ignored");
  }
});

Deno.test("extension-derived binary types still require matching magic bytes", () => {
  const text = new TextEncoder().encode("not a PDF");
  if (
    verifyFileType(
      text,
      fileKindFromUpload("application/octet-stream", "fake.pdf"),
    )
  ) {
    throw new Error("Extension-only PDF bypassed magic-byte verification");
  }
});
