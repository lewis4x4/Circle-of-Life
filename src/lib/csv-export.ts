/**
 * RFC-style CSV cell escaping and browser download for admin hub exports.
 * Keep escaping logic in one place for consistent injection-safe exports.
 */
export function csvEscapeCell(value: string): string {
  let v = value;
  // Reduce CSV/formula injection when files are opened in Excel/Sheets (leading =, +, -, @, tab).
  if (/^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  if (/[",\r\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function triggerCsvDownload(filename: string, text: string): void {
  const blob = new Blob([text], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
