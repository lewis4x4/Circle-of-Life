"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Download, FolderOpen, HardDrive, Loader2, Trash2, Upload } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  WORKSPACE_FILES_BUCKET,
  buildStoragePath,
  formatBytes,
  type QueryResult,
  type WorkspaceFileRow,
} from "@/lib/office/workspace-files";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

export default function AdminWorkspaceFilesPage() {
  const supabase = createClient();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [files, setFiles] = useState<WorkspaceFileRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [folder, setFolder] = useState("General");
  const [showTrash, setShowTrash] = useState(false);
  const [folderFilter, setFolderFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const res = (await supabase
        .from("workspace_files" as never)
        .select(
          "id, owner_user_id, name, original_filename, storage_path, mime_type, size_bytes, folder, visibility, created_at",
        )
        .eq("owner_user_id", actor.userId)
        .filter("deleted_at", showTrash ? "not.is" : "is", null)
        .order("created_at", { ascending: false })
        .limit(300)) as unknown as QueryResult<WorkspaceFileRow>;
      if (res.error) throw new Error(res.error.message);
      setFiles(res.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load your files.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, showTrash]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleUpload = useCallback(
    async (file: File) => {
      setUploading(true);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Could not resolve your profile.");
        const fileId = crypto.randomUUID();
        const path = buildStoragePath(actor.userId, fileId, file.name);
        const up = await supabase.storage
          .from(WORKSPACE_FILES_BUCKET)
          .upload(path, file, { contentType: file.type || undefined, upsert: false });
        if (up.error) throw new Error(up.error.message);
        const { error: metaErr } = await supabase.from("workspace_files" as never).insert({
          id: fileId,
          organization_id: actor.organizationId,
          owner_user_id: actor.userId,
          name: file.name,
          original_filename: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          folder: folder.trim() || "General",
          created_by: actor.userId,
          updated_by: actor.userId,
        } as never);
        if (metaErr) {
          await supabase.storage.from(WORKSPACE_FILES_BUCKET).remove([path]);
          throw new Error(metaErr.message);
        }
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Upload failed.");
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = "";
      }
    },
    [supabase, folder, load],
  );

  const download = useCallback(
    async (f: WorkspaceFileRow) => {
      setBusyId(f.id);
      setNotice(null);
      try {
        const res = await supabase.storage
          .from(WORKSPACE_FILES_BUCKET)
          .createSignedUrl(f.storage_path, 120);
        if (res.error || !res.data?.signedUrl) throw new Error(res.error?.message ?? "No URL");
        window.open(res.data.signedUrl, "_blank", "noopener,noreferrer");
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Download failed.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase],
  );

  const removeFile = useCallback(
    async (f: WorkspaceFileRow) => {
      setBusyId(f.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        const { error } = await supabase
          .from("workspace_files" as never)
          .update({ deleted_at: showTrash ? null : new Date().toISOString(), updated_by: actor?.userId } as never)
          .eq("id", f.id).select("id").single();
        if (error) throw new Error(error.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Delete failed.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, load, showTrash],
  );

  const folders = useMemo(() => {
    const set = new Set(files.map((f) => f.folder));
    return Array.from(set).sort();
  }, [files]);

  const visibleFiles = useMemo(
    () => (folderFilter === "all" ? files : files.filter((f) => f.folder === folderFilter)),
    [files, folderFilter],
  );

  const inputCls = "rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <HardDrive className="h-8 w-8 text-info shrink-0" aria-hidden />
            My files
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Private file drive. Only you can open these; owners/administrators can break-glass with
            a logged reason. Files transfer to your manager at offboarding — never deleted silently.
          </p>
        </header>

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        <section className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-border bg-card p-4">
          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
            Folder
            <input
              type="text"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              aria-label="Upload folder"
              className={inputCls}
            />
          </label>
          <input
            ref={fileInputRef}
            type="file"
            aria-label="Choose file to upload"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleUpload(f);
            }}
            className="text-sm text-muted-foreground file:mr-3 file:rounded-[9px] file:border file:border-border file:bg-muted file:px-3 file:py-2 file:text-sm file:text-foreground"
          />
          {uploading ? (
            <span className="inline-flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              Uploading…
            </span>
          ) : (
            <Upload className="h-4 w-4 text-muted-foreground" aria-hidden />
          )}
        </section>

        <div className="flex items-center gap-3"><Button type="button" variant="outline" onClick={() => setShowTrash((current) => !current)}>{showTrash ? "Back to files" : "Open Trash"}</Button><span className="text-sm text-muted-foreground">Trash preserves files until restored. Permanent disposal is handled through the approved retention process.</span></div>
        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError ? (
          <section className="space-y-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                aria-pressed={folderFilter === "all"}
                onClick={() => setFolderFilter("all")}
                className={cn(
                  "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                  folderFilter === "all"
                    ? "bg-primary text-primary-foreground"
                    : "bg-card text-muted-foreground border border-border hover:bg-muted",
                )}
              >
                All ({files.length})
              </button>
              {folders.map((fdr) => (
                <button
                  key={fdr}
                  type="button"
                  aria-pressed={folderFilter === fdr}
                  onClick={() => setFolderFilter(fdr)}
                  className={cn(
                    "inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium transition-colors",
                    folderFilter === fdr
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground border border-border hover:bg-muted",
                  )}
                >
                  <FolderOpen className="h-3 w-3" aria-hidden />
                  {fdr}
                </button>
              ))}
            </div>

            {visibleFiles.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-2">No files yet.</p>
            ) : (
              <ul className="space-y-2">
                {visibleFiles.map((f) => (
                  <li
                    key={f.id}
                    className="flex items-center justify-between gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card"
                  >
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-medium text-foreground truncate">{f.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {f.folder} · {formatBytes(f.size_bytes)} · {ET_FMT.format(new Date(f.created_at))}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <StatusPill tone={f.visibility === "private" ? "muted" : "info"}>
                        {f.visibility}
                      </StatusPill>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="gap-2"
                        disabled={busyId === f.id}
                        onClick={() => void download(f)}
                      >
                        <Download className="h-4 w-4" aria-hidden />
                        Open
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="gap-2 text-danger"
                        disabled={busyId === f.id}
                        onClick={() => void removeFile(f)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                        {showTrash ? "Restore" : "Move to Trash"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
