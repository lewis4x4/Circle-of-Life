import { WORKSPACE_FILE_NO_SIZE_COPY } from "./workspace-files-display-copy";

export const WORKSPACE_FILES_BUCKET = "workspace-files";

export type WorkspaceFileRow = {
  id: string;
  owner_user_id: string;
  name: string;
  original_filename: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  folder: string;
  visibility: "private" | "team" | "org";
  created_at: string;
};

export type QueryError = { message: string };
export type QueryResult<T> = { data: T[] | null; error: QueryError | null };

/** Object path: {owner_user_id}/{file_id}/{sanitized filename}. */
export function buildStoragePath(ownerUserId: string, fileId: string, filename: string): string {
  return `${ownerUserId}/${fileId}/${sanitizeFilename(filename)}`;
}

export function sanitizeFilename(name: string): string {
  const trimmed = name.trim().replace(/[/\\]/g, "_");
  const cleaned = trimmed.replace(/[^A-Za-z0-9._ -]/g, "").replace(/\s+/g, " ");
  return cleaned.slice(0, 180) || "file";
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return WORKSPACE_FILE_NO_SIZE_COPY;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
