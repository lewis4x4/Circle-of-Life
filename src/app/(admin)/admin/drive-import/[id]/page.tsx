"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, CloudUpload, Loader2, Play } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  IMPORT_DESTINATIONS,
  destinationLabel,
  importBookmarkBody,
  importStatusTone,
  isMappable,
  parseManifest,
  type DriveBatchRow,
  type DriveFileRow,
  type ImportDestination,
  type QueryResult,
} from "@/lib/office/drive-import";
import { wordCount } from "@/lib/office/publish";
import { type OrgUserMini, type TeamSpaceRow, userLabel } from "@/lib/office/teams";
import { createClient } from "@/lib/supabase/client";

export default function AdminDriveImportBatchPage() {
  const supabase = createClient();
  const params = useParams<{ id: string }>();
  const batchId = params?.id;

  const [batch, setBatch] = useState<DriveBatchRow | null>(null);
  const [batchFacilityId, setBatchFacilityId] = useState<string | null>(null);
  const [files, setFiles] = useState<DriveFileRow[]>([]);
  const [orgUsers, setOrgUsers] = useState<OrgUserMini[]>([]);
  const [spaces, setSpaces] = useState<TeamSpaceRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [manifest, setManifest] = useState("");
  const [loadingManifest, setLoadingManifest] = useState(false);
  const [importing, setImporting] = useState(false);

  const load = useCallback(async () => {
    if (!batchId) return;
    setIsLoading(true);
    setLoadError(null);
    try {
      const batchRes = (await supabase
        .from("drive_import_batches" as never)
        .select("id, name, status, notes, created_at, facility_id")
        .eq("id", batchId)
        .is("deleted_at", null)
        .single()) as unknown as {
        data: (DriveBatchRow & { facility_id: string }) | null;
        error: { message: string } | null;
      };
      if (batchRes.error) throw new Error(batchRes.error.message);
      setBatch(batchRes.data);
      setBatchFacilityId(batchRes.data?.facility_id ?? null);

      const filesRes = (await supabase
        .from("drive_import_files" as never)
        .select(
          "id, batch_id, source_name, source_path, source_drive_id, mime_type, size_bytes, web_view_link, destination, owner_user_id, team_space_id, status, imported_ref_type, imported_ref_id, error",
        )
        .eq("batch_id", batchId)
        .is("deleted_at", null)
        .order("source_name")
        .limit(2000)) as unknown as QueryResult<DriveFileRow>;
      if (filesRes.error) throw new Error(filesRes.error.message);
      setFiles(filesRes.data ?? []);

      const actor = await fetchActorContext(supabase);
      if (actor) {
        const usersRes = (await supabase
          .from("user_profiles")
          .select("id, full_name, email, app_role")
          .eq("organization_id", actor.organizationId)
          .eq("is_active", true)
          .is("deleted_at", null)
          .order("full_name")
          .limit(500)) as unknown as QueryResult<OrgUserMini>;
        if (!usersRes.error) setOrgUsers(usersRes.data ?? []);
      }

      const spacesRes = (await supabase
        .from("team_spaces" as never)
        .select("id, name, description, is_active, created_by, created_at")
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("name")
        .limit(500)) as unknown as QueryResult<TeamSpaceRow>;
      if (!spacesRes.error) setSpaces(spacesRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load the batch.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, batchId]);

  useEffect(() => {
    void load();
  }, [load]);

  const ingestManifest = useCallback(async () => {
    if (!batchId) return;
    const parsed = parseManifest(manifest);
    if (parsed.length === 0) {
      setNotice("No file rows found in that manifest. Paste a Drive JSON array or CSV with a header.");
      return;
    }
    if (!batchFacilityId) {
      setNotice("Batch facility not resolved yet — reload and try again.");
      return;
    }
    setLoadingManifest(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const rows = parsed.map((p) => ({
        organization_id: actor.organizationId,
        facility_id: batchFacilityId,
        batch_id: batchId,
        source_name: p.source_name,
        source_path: p.source_path,
        source_drive_id: p.source_drive_id,
        mime_type: p.mime_type,
        size_bytes: p.size_bytes,
        web_view_link: p.web_view_link,
        destination: "unassigned",
        status: "pending",
        created_by: actor.userId,
        updated_by: actor.userId,
      }));
      const { error } = await supabase.from("drive_import_files" as never).insert(rows as never);
      if (error) throw new Error(error.message);
      setManifest("");
      setNotice(`Loaded ${rows.length} file row(s).`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to load the manifest.");
    } finally {
      setLoadingManifest(false);
    }
  }, [supabase, batchId, batchFacilityId, manifest, load]);

  const updateFile = useCallback(
    async (id: string, patch: Partial<DriveFileRow>) => {
      setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
      try {
        const actor = await fetchActorContext(supabase);
        const status = patch.destination
          ? patch.destination === "unassigned"
            ? "pending"
            : "mapped"
          : undefined;
        const { error } = await supabase
          .from("drive_import_files" as never)
          .update({ ...patch, ...(status ? { status } : {}), updated_by: actor?.userId ?? null } as never)
          .eq("id", id);
        if (error) throw new Error(error.message);
        if (status) setFiles((prev) => prev.map((f) => (f.id === id ? { ...f, status } : f)));
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to update mapping.");
      }
    },
    [supabase],
  );

  const runImport = useCallback(async () => {
    if (!batchId) return;
    setImporting(true);
    setNotice(null);
    let imported = 0;
    let failed = 0;
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const queue = files.filter(
        (f) => (f.status === "mapped" || f.status === "pending") && f.destination !== "unassigned" && isMappable(f),
      );
      for (const f of queue) {
        try {
          if (f.destination === "skip") {
            await supabase
              .from("drive_import_files" as never)
              .update({ status: "skipped", updated_by: actor.userId } as never)
              .eq("id", f.id);
            continue;
          }
          if (f.destination === "knowledge_base") {
            const docRes = (await supabase
              .from("documents")
              .insert({
                workspace_id: actor.organizationId,
                title: f.source_name,
                raw_text: importBookmarkBody(f),
                source: "drive_import",
                status: "published",
                uploaded_by: actor.userId,
                approved_by: actor.userId,
                approved_at: new Date().toISOString(),
                word_count: wordCount(importBookmarkBody(f)),
              } as never)
              .select("id")
              .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
            if (docRes.error) throw new Error(docRes.error.message);
            await supabase
              .from("drive_import_files" as never)
              .update({
                status: "imported",
                imported_ref_type: "document",
                imported_ref_id: docRes.data?.id ?? null,
                error: null,
                updated_by: actor.userId,
              } as never)
              .eq("id", f.id);
            imported += 1;
            continue;
          }
          // private_page or team_page → workspace_pages bookmark
          const isTeam = f.destination === "team_page";
          const pageRes = (await supabase
            .from("workspace_pages" as never)
            .insert({
              organization_id: actor.organizationId,
              owner_user_id: isTeam ? actor.userId : f.owner_user_id,
              title: f.source_name,
              body: importBookmarkBody(f),
              template_kind: "blank",
              visibility: isTeam ? "team" : "private",
              team_space_id: isTeam ? f.team_space_id : null,
              created_by: actor.userId,
              updated_by: actor.userId,
            } as never)
            .select("id")
            .single()) as unknown as { data: { id: string } | null; error: { message: string } | null };
          if (pageRes.error) throw new Error(pageRes.error.message);
          await supabase
            .from("drive_import_files" as never)
            .update({
              status: "imported",
              imported_ref_type: "workspace_page",
              imported_ref_id: pageRes.data?.id ?? null,
              error: null,
              updated_by: actor.userId,
            } as never)
            .eq("id", f.id);
          imported += 1;
        } catch (err) {
          failed += 1;
          await supabase
            .from("drive_import_files" as never)
            .update({
              status: "failed",
              error: err instanceof Error ? err.message : "Import failed",
              updated_by: actor.userId,
            } as never)
            .eq("id", f.id);
        }
      }
      setNotice(`Imported ${imported} item(s)${failed ? `, ${failed} failed` : ""}.`);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Import run failed.");
    } finally {
      setImporting(false);
    }
  }, [supabase, batchId, files, load]);

  const counts = useMemo(() => {
    const c = { total: files.length, mapped: 0, imported: 0, failed: 0, pending: 0 };
    for (const f of files) {
      if (f.status === "imported") c.imported += 1;
      else if (f.status === "mapped") c.mapped += 1;
      else if (f.status === "failed") c.failed += 1;
      else if (f.status === "pending") c.pending += 1;
    }
    return c;
  }, [files]);

  const readyToImport = useMemo(
    () =>
      files.filter(
        (f) => (f.status === "mapped" || f.status === "pending") && f.destination !== "unassigned" && isMappable(f),
      ).length,
    [files],
  );

  const inputCls = "rounded-[9px] border border-border bg-background px-2 py-1.5 text-xs text-foreground";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2 space-y-2">
          <Link
            href="/admin/drive-import"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Import batches
          </Link>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <CloudUpload className="h-8 w-8 text-info shrink-0" aria-hidden />
            {batch?.name ?? "Import batch"}
          </h2>
          <p className="text-sm text-muted-foreground">
            {counts.total} file(s) · {counts.imported} imported · {counts.mapped} mapped ·{" "}
            {counts.pending} pending{counts.failed ? ` · ${counts.failed} failed` : ""}
          </p>
        </header>

        {notice ? (
          <p className="rounded-[var(--radius)] border border-border bg-muted/40 px-6 py-3 text-sm text-foreground">
            {notice}
          </p>
        ) : null}

        <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-2 max-w-3xl">
          <label className="block text-xs text-muted-foreground" htmlFor="manifest">
            Drive manifest (JSON array from Drive API <code>files.list</code>, or CSV with a header row)
          </label>
          <textarea
            id="manifest"
            value={manifest}
            onChange={(e) => setManifest(e.target.value)}
            rows={5}
            placeholder='[{"id":"…","name":"Handbook.docx","mimeType":"…","webViewLink":"…"}]'
            className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm font-mono text-foreground"
          />
          <Button type="button" disabled={loadingManifest || !manifest.trim()} onClick={() => void ingestManifest()} className="gap-2">
            {loadingManifest ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CloudUpload className="h-4 w-4" aria-hidden />}
            Load manifest
          </Button>
          <p className="text-xs text-muted-foreground">
            Binary file bytes transfer via the Drive API behind owner-provided OAuth credentials. This
            tool records the mapping and creates Knowledge Base / workspace bookmarks linking each
            original Drive item.
          </p>
        </div>

        {isLoading ? <AdminTableLoadingState /> : null}
        {!isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {!isLoading && !loadError && files.length > 0 ? (
          <>
            <div className="flex items-center gap-3">
              <Button type="button" disabled={importing || readyToImport === 0} onClick={() => void runImport()} className="gap-2">
                {importing ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Play className="h-4 w-4" aria-hidden />}
                Import {readyToImport} mapped item(s)
              </Button>
            </div>

            <div className="overflow-x-auto rounded-[var(--radius)] border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">File</th>
                    <th className="px-3 py-2 text-left font-medium">Destination</th>
                    <th className="px-3 py-2 text-left font-medium">Owner / team</th>
                    <th className="px-3 py-2 text-left font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => (
                    <tr key={f.id} className="border-t border-border align-top">
                      <td className="px-3 py-2">
                        <span className="block text-foreground">{f.source_name}</span>
                        <span className="block text-xs text-muted-foreground">
                          {f.source_path ? `${f.source_path} · ` : ""}
                          {f.mime_type ?? "unknown type"}
                        </span>
                        {f.error ? <span className="block text-xs text-danger">{f.error}</span> : null}
                      </td>
                      <td className="px-3 py-2">
                        <select
                          value={f.destination}
                          disabled={f.status === "imported"}
                          onChange={(e) => void updateFile(f.id, { destination: e.target.value as ImportDestination })}
                          aria-label={`Destination for ${f.source_name}`}
                          className={inputCls}
                        >
                          {IMPORT_DESTINATIONS.map((d) => (
                            <option key={d.id} value={d.id}>
                              {d.label}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-2">
                        {f.destination === "private_page" ? (
                          <select
                            value={f.owner_user_id ?? ""}
                            disabled={f.status === "imported"}
                            onChange={(e) => void updateFile(f.id, { owner_user_id: e.target.value || null })}
                            aria-label={`Owner for ${f.source_name}`}
                            className={inputCls}
                          >
                            <option value="">Select employee…</option>
                            {orgUsers.map((u) => (
                              <option key={u.id} value={u.id}>
                                {userLabel(u.id, orgUsers)}
                              </option>
                            ))}
                          </select>
                        ) : f.destination === "team_page" ? (
                          <select
                            value={f.team_space_id ?? ""}
                            disabled={f.status === "imported"}
                            onChange={(e) => void updateFile(f.id, { team_space_id: e.target.value || null })}
                            aria-label={`Team space for ${f.source_name}`}
                            className={inputCls}
                          >
                            <option value="">Select team…</option>
                            {spaces.map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <span className="text-xs text-muted-foreground">{destinationLabel(f.destination)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <StatusPill tone={importStatusTone(f.status)}>{f.status}</StatusPill>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        ) : null}

        {!isLoading && !loadError && files.length === 0 ? (
          <p className="text-sm text-muted-foreground pl-2">
            No files loaded yet. Paste a Drive manifest above to begin mapping.
          </p>
        ) : null}
      </div>
    </div>
  );
}
