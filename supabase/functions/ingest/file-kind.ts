export type FileKind = "pdf" | "docx" | "spreadsheet" | "markdown" | "text";

function kindFromExtension(fileName: string): FileKind | null {
  const extension = fileName.trim().toLowerCase().match(/\.([^.]+)$/)?.[1];
  switch (extension) {
    case "pdf":
      return "pdf";
    case "docx":
      return "docx";
    case "xlsx":
    case "xls":
    case "csv":
      return "spreadsheet";
    case "md":
    case "markdown":
      return "markdown";
    case "txt":
      return "text";
    default:
      return null;
  }
}

/** Browsers frequently label Markdown and Office files as octet-stream. */
export function fileKindFromUpload(
  mimeType: string,
  fileName: string,
): FileKind {
  const mime = mimeType.split(";", 1)[0]!.trim().toLowerCase();
  if (mime === "application/pdf") return "pdf";
  if (
    mime ===
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) return "docx";
  if (
    mime.includes("spreadsheet") || mime.includes("excel") ||
    mime === "text/csv"
  ) return "spreadsheet";
  if (mime === "text/markdown" || mime === "text/x-markdown") return "markdown";

  return kindFromExtension(fileName) ?? "text";
}

export function verifyFileType(header: Uint8Array, kind: FileKind): boolean {
  const isPdf = header[0] === 0x25 && header[1] === 0x50 &&
    header[2] === 0x44 && header[3] === 0x46;
  const isZip = header[0] === 0x50 && header[1] === 0x4b &&
    header[2] === 0x03 && header[3] === 0x04;
  const isOle = header[0] === 0xd0 && header[1] === 0xcf &&
    header[2] === 0x11 && header[3] === 0xe0;
  switch (kind) {
    case "pdf":
      return isPdf;
    case "docx":
      return isZip;
    case "spreadsheet":
      return isZip || isOle;
    default:
      return true;
  }
}
