export type BatchStatus = "mapping" | "importing" | "complete" | "archived";

export type ImportDestination =
  | "unassigned"
  | "private_page"
  | "team_page"
  | "knowledge_base"
  | "skip";

export type ImportFileStatus = "pending" | "mapped" | "imported" | "skipped" | "failed";

export const IMPORT_DESTINATIONS: { id: ImportDestination; label: string }[] = [
  { id: "unassigned", label: "Unassigned" },
  { id: "private_page", label: "Private page (owner)" },
  { id: "team_page", label: "Team space page" },
  { id: "knowledge_base", label: "Knowledge Base" },
  { id: "skip", label: "Skip / archive only" },
];

export type DriveBatchRow = {
  id: string;
  name: string;
  status: BatchStatus;
  notes: string | null;
  created_at: string;
};

export type DriveFileRow = {
  id: string;
  batch_id: string;
  source_name: string;
  source_path: string | null;
  source_drive_id: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  web_view_link: string | null;
  destination: ImportDestination;
  owner_user_id: string | null;
  team_space_id: string | null;
  status: ImportFileStatus;
  imported_ref_type: "document" | "workspace_page" | null;
  imported_ref_id: string | null;
  error: string | null;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

export type ParsedManifestRow = {
  source_name: string;
  source_path: string | null;
  source_drive_id: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  web_view_link: string | null;
};

export function destinationLabel(id: string): string {
  return IMPORT_DESTINATIONS.find((d) => d.id === id)?.label ?? id.replace(/_/g, " ");
}

export function importStatusTone(
  status: ImportFileStatus,
): "success" | "warning" | "danger" | "info" | "muted" {
  switch (status) {
    case "imported":
      return "success";
    case "mapped":
      return "info";
    case "failed":
      return "danger";
    case "skipped":
      return "muted";
    default:
      return "warning";
  }
}

/**
 * Parse a Drive manifest. Accepts a JSON array of objects (Drive API
 * `files.list` shape or a simplified export) or CSV with a header row.
 * Defensive: skips rows without a name, never throws.
 */
export function parseManifest(raw: string): ParsedManifestRow[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.startsWith("[") || text.startsWith("{")) {
    return parseJsonManifest(text);
  }
  return parseCsvManifest(text);
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseJsonManifest(text: string): ParsedManifestRow[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  const arr = Array.isArray(data)
    ? data
    : Array.isArray((data as { files?: unknown[] })?.files)
      ? (data as { files: unknown[] }).files
      : [];
  const out: ParsedManifestRow[] = [];
  for (const item of arr) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const name = String(o.name ?? o.source_name ?? o.title ?? "").trim();
    if (!name) continue;
    out.push({
      source_name: name,
      source_path: strOrNull(o.path ?? o.source_path ?? o.parents),
      source_drive_id: strOrNull(o.id ?? o.source_drive_id ?? o.fileId),
      mime_type: strOrNull(o.mimeType ?? o.mime_type),
      size_bytes: toNumber(o.size ?? o.size_bytes ?? o.sizeBytes),
      web_view_link: strOrNull(o.webViewLink ?? o.web_view_link ?? o.link),
    });
  }
  return out;
}

function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s : null;
}

function parseCsvManifest(text: string): ParsedManifestRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const idx = (...names: string[]) => {
    for (const n of names) {
      const i = header.indexOf(n);
      if (i >= 0) return i;
    }
    return -1;
  };
  const nameI = idx("name", "source_name", "title");
  const pathI = idx("path", "source_path", "folder");
  const driveI = idx("id", "source_drive_id", "fileid");
  const mimeI = idx("mimetype", "mime_type", "type");
  const sizeI = idx("size", "size_bytes");
  const linkI = idx("webviewlink", "web_view_link", "link", "url");

  const out: ParsedManifestRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cols = splitCsvLine(lines[i]);
    const name = (nameI >= 0 ? cols[nameI] : "")?.trim();
    if (!name) continue;
    out.push({
      source_name: name,
      source_path: pathI >= 0 ? strOrNull(cols[pathI]) : null,
      source_drive_id: driveI >= 0 ? strOrNull(cols[driveI]) : null,
      mime_type: mimeI >= 0 ? strOrNull(cols[mimeI]) : null,
      size_bytes: sizeI >= 0 ? toNumber(cols[sizeI]) : null,
      web_view_link: linkI >= 0 ? strOrNull(cols[linkI]) : null,
    });
  }
  return out;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Body text for an imported text bookmark referencing the original Drive item. */
export function importBookmarkBody(file: DriveFileRow): string {
  const lines = [
    `Imported from Google Drive during cutover.`,
    file.source_path ? `Original location: ${file.source_path}` : null,
    file.mime_type ? `Type: ${file.mime_type}` : null,
    file.web_view_link ? `Drive link: ${file.web_view_link}` : null,
    file.source_drive_id ? `Drive file id: ${file.source_drive_id}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

/** Whether a file row has enough mapping to be imported. */
export function isMappable(file: DriveFileRow): boolean {
  if (file.destination === "private_page") return Boolean(file.owner_user_id);
  if (file.destination === "team_page") return Boolean(file.team_space_id);
  if (file.destination === "knowledge_base") return true;
  if (file.destination === "skip") return true;
  return false;
}
