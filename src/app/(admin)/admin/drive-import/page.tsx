"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { CloudUpload, Loader2, Plus } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { fetchActorContext } from "@/lib/office/meetings";
import { type DriveBatchRow, type QueryResult } from "@/lib/office/drive-import";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

function batchTone(status: string): "success" | "info" | "warning" | "muted" {
  switch (status) {
    case "complete":
      return "success";
    case "importing":
      return "info";
    case "archived":
      return "muted";
    default:
      return "warning";
  }
}

export default function AdminDriveImportPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [batches, setBatches] = useState<DriveBatchRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setBatches([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const res = (await supabase
        .from("drive_import_batches" as never)
        .select("id, name, status, notes, created_at")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200)) as unknown as QueryResult<DriveBatchRow>;
      if (res.error) throw new Error(res.error.message);
      setBatches(res.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load import batches.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, facilityReady, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const createBatch = useCallback(async () => {
    if (!facilityReady || !name.trim()) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("drive_import_batches" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        name: name.trim(),
        status: "mapping",
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setName("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to create the batch.");
    } finally {
      setSaving(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, name, load]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-4xl">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <CloudUpload className="h-8 w-8 text-info shrink-0" aria-hidden />
            Google Drive import
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Cutover workspace for the 2026-07-01 Drive read-only date. Create a batch, load a Drive
            manifest, map each item to an employee, team space, or the Knowledge Base, and record the
            import.
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — import batches are per-facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady ? (
          <div className="flex flex-wrap items-end gap-2 rounded-[var(--radius)] border border-border bg-card p-4">
            <label className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground min-w-[220px]">
              New batch name
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Oakridge shared drive — June"
                aria-label="Batch name"
                className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
              />
            </label>
            <Button type="button" disabled={saving || !name.trim()} onClick={() => void createBatch()} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
              Create batch
            </Button>
          </div>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          batches.length === 0 ? (
            <p className="text-sm text-muted-foreground pl-2">No import batches yet.</p>
          ) : (
            <ul className="space-y-2">
              {batches.map((b) => (
                <li key={b.id} className="rounded-[var(--radius)] border border-border bg-card">
                  <Link
                    href={`/admin/drive-import/${b.id}`}
                    className="flex items-center justify-between gap-2 px-[13px] py-3 hover:bg-muted/40 transition-colors rounded-[var(--radius)]"
                  >
                    <span className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold text-foreground truncate">{b.name}</span>
                      <span className="text-xs text-muted-foreground">
                        Created {ET_FMT.format(new Date(b.created_at))}
                      </span>
                    </span>
                    <StatusPill tone={batchTone(b.status)}>{b.status}</StatusPill>
                  </Link>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
    </div>
  );
}
