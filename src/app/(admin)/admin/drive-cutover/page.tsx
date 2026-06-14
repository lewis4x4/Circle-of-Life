"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Loader2, ShieldCheck } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  DRIVE_CUTOFF_DATE,
  canAttest,
  daysUntilCutoff,
  migrationComplete,
  rollupFromStatuses,
  type CutoverAttestationRow,
  type ImportRollup,
  type QueryResult,
} from "@/lib/office/drive-cutover";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

export default function AdminDriveCutoverPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [rollup, setRollup] = useState<ImportRollup | null>(null);
  const [attestations, setAttestations] = useState<CutoverAttestationRow[]>([]);
  const [role, setRole] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [readonlyConfirmed, setReadonlyConfirmed] = useState(false);
  const [attestNotes, setAttestNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setRollup(null);
      setAttestations([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const fid = selectedFacilityId as string;

      const actor = await fetchActorContext(supabase);
      if (actor) {
        const profileRes = (await supabase
          .from("user_profiles")
          .select("app_role")
          .eq("id", actor.userId)
          .single()) as unknown as { data: { app_role: string } | null };
        setRole(profileRes.data?.app_role ?? null);
      }

      const batchesRes = (await supabase
        .from("drive_import_batches" as never)
        .select("id")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .limit(1000)) as unknown as QueryResult<{ id: string }>;
      if (batchesRes.error) throw new Error(batchesRes.error.message);

      const filesRes = (await supabase
        .from("drive_import_files" as never)
        .select("status")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .limit(5000)) as unknown as QueryResult<{ status: string }>;
      if (filesRes.error) throw new Error(filesRes.error.message);

      const statusRollup = rollupFromStatuses((filesRes.data ?? []).map((f) => f.status));
      setRollup({ batches: (batchesRes.data ?? []).length, ...statusRollup });

      const attestRes = (await supabase
        .from("drive_cutover_attestations" as never)
        .select("id, cutoff_date, drive_set_readonly, notes, attested_by, attested_at")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("attested_at", { ascending: false })
        .limit(50)) as unknown as QueryResult<CutoverAttestationRow>;
      if (attestRes.error) throw new Error(attestRes.error.message);
      setAttestations(attestRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load cutover status.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, facilityReady, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const attest = useCallback(async () => {
    if (!facilityReady) return;
    setSaving(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("drive_cutover_attestations" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        cutoff_date: DRIVE_CUTOFF_DATE,
        drive_set_readonly: readonlyConfirmed,
        notes: attestNotes.trim() || null,
        attested_by: actor.userId,
        attested_at: new Date().toISOString(),
        created_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setAttestNotes("");
      setReadonlyConfirmed(false);
      setNotice("Cutover attestation recorded.");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to record the attestation.");
    } finally {
      setSaving(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, readonlyConfirmed, attestNotes, load]);

  const days = useMemo(() => daysUntilCutoff(), []);
  const complete = rollup ? migrationComplete(rollup) : false;
  const signedOff = attestations.some((a) => a.drive_set_readonly);
  const showAttest = canAttest(role);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-3xl">
        <header className="mb-2 space-y-1">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-info shrink-0" aria-hidden />
            Drive cutover
          </h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            F0-5 hard cutoff: <strong>{DRIVE_CUTOFF_DATE}</strong> — Google Drive becomes a read-only
            archive and Haven is the system of record.{" "}
            <Link href="/admin/drive-import" className="text-info hover:underline">
              Manage imports
            </Link>
            .
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — cutover is recorded per-facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-border bg-muted/40 px-6 py-3 text-sm text-foreground">
            {notice}
          </p>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-[var(--radius)] border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Days to cutoff</p>
                <p className={`text-2xl font-semibold ${days <= 14 ? "text-warning" : "text-foreground"}`}>
                  {days >= 0 ? days : `${Math.abs(days)} past`}
                </p>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Migration</p>
                <div className="mt-1">
                  <StatusPill tone={complete ? "success" : rollup && rollup.files > 0 ? "warning" : "muted"}>
                    {complete ? "complete" : rollup && rollup.files > 0 ? "in progress" : "not started"}
                  </StatusPill>
                </div>
              </div>
              <div className="rounded-[var(--radius)] border border-border bg-card px-4 py-3">
                <p className="text-xs text-muted-foreground">Drive read-only</p>
                <div className="mt-1">
                  <StatusPill tone={signedOff ? "success" : "muted"}>
                    {signedOff ? "attested" : "not attested"}
                  </StatusPill>
                </div>
              </div>
            </div>

            {rollup ? (
              <div className="rounded-[var(--radius)] border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                {rollup.batches} batch(es) · {rollup.files} file(s) · {rollup.imported} imported ·{" "}
                {rollup.mapped} mapped · {rollup.pending} pending · {rollup.skipped} skipped
                {rollup.failed ? ` · ${rollup.failed} failed` : ""}
              </div>
            ) : null}

            {showAttest ? (
              <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Record cutover sign-off</h3>
                {!complete ? (
                  <p className="rounded-[9px] border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
                    Imports are not fully resolved. You can still attest, but resolve pending/failed
                    items first for a clean cutover.
                  </p>
                ) : null}
                <label className="flex items-start gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={readonlyConfirmed}
                    onChange={(e) => setReadonlyConfirmed(e.target.checked)}
                    className="mt-1"
                  />
                  I confirm Google Drive has been set read-only for this facility and Haven is the
                  system of record.
                </label>
                <textarea
                  value={attestNotes}
                  onChange={(e) => setAttestNotes(e.target.value)}
                  rows={2}
                  placeholder="Notes (optional) — e.g. who flipped Drive, residual archive location"
                  aria-label="Attestation notes"
                  className="w-full rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                />
                <Button type="button" disabled={saving || !readonlyConfirmed} onClick={() => void attest()} className="gap-2">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <CheckCircle2 className="h-4 w-4" aria-hidden />}
                  Record sign-off
                </Button>
              </div>
            ) : null}

            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Attestation history</h3>
              {attestations.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">No cutover sign-off recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {attestations.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-col gap-1 rounded-[var(--radius)] border border-border bg-card px-[13px] py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm text-foreground">
                          {ET_FMT.format(new Date(a.attested_at))} ET
                        </span>
                        <StatusPill tone={a.drive_set_readonly ? "success" : "muted"}>
                          {a.drive_set_readonly ? "read-only confirmed" : "noted"}
                        </StatusPill>
                      </div>
                      {a.notes ? <span className="text-xs text-muted-foreground">{a.notes}</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
