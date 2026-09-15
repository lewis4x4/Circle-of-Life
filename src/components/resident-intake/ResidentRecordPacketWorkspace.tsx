"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCcw, ShieldAlert, Sparkles } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { cn } from "@/lib/utils";

import { loadResidentIntake, requestResidentIntakeParse, sendResidentIntakeCommand } from "./api";
import { FactConflictReview } from "./FactConflictReview";
import { IntakeChecklist } from "./IntakeChecklist";
import { ManualFactProposal } from "./ManualFactProposal";
import { PacketSourceList } from "./PacketSourceList";
import { ResidentMatchReview } from "./ResidentMatchReview";
import { normalizeResidentIntakeSnapshot, type ResidentIntakePrimaryState, type ResidentIntakeSnapshot } from "./types";

export type ResidentRecordPacketWorkspaceProps = { intakeId: string };

const STATE_COPY: Record<ResidentIntakePrimaryState, { title: string; message: string; tone: "muted" | "success" | "warning" | "danger" | "info" }> = {
  idle: { title: "Packet not started", message: "Add documents from New admission case to begin review.", tone: "muted" },
  uploading: { title: "Documents uploading", message: "Keep this workspace open while each document is confirmed.", tone: "info" },
  upload_failed: { title: "A document needs another attempt", message: "Confirmed documents are safe. Retry only the document marked for attention.", tone: "danger" },
  ready_to_parse: { title: "Ready for document review", message: "Classify each document and confirm credential checks before automated review.", tone: "info" },
  parsing: { title: "Reviewing documents", message: "Haven is preparing proposed facts. No resident record is changed during this step.", tone: "info" },
  parse_failed: { title: "Automated review is unavailable", message: "Retry the affected document or continue with manual classification and fact review.", tone: "danger" },
  match_required: { title: "Resident confirmation required", message: "Choose an existing resident or create an inquiry-only profile. Haven will not choose automatically.", tone: "warning" },
  review_empty: { title: "No proposed facts yet", message: "Review a classified resident document or add a controlled fact manually.", tone: "muted" },
  review_populated: { title: "Facts ready for review", message: "Compare current and proposed values, then approve each fact separately.", tone: "info" },
  quarantined: { title: "Credential review required", message: "At least one document is held away from automated review and the resident chart.", tone: "danger" },
  conflicting: { title: "Conflicts require a decision", message: "Choose or correct the intended value. Confidence never resolves a conflict automatically.", tone: "danger" },
  partially_applied: { title: "Some facts are applied", message: "Applied facts are recorded. Continue reviewing the remaining facts and held documents.", tone: "warning" },
  complete: { title: "Packet review complete", message: "Reviewed facts and accepted documents are recorded. Move-in and arrival remain separate workflows.", tone: "success" },
};

function PrimaryState({ state }: { state: ResidentIntakePrimaryState }) {
  const copy = STATE_COPY[state];
  const Icon = copy.tone === "danger" ? ShieldAlert : copy.tone === "success" ? CheckCircle2 : copy.tone === "warning" ? AlertTriangle : Sparkles;
  return (
    <section aria-label="Packet review status" className={cn(
      "flex items-start gap-3 rounded-xl border px-4 py-3",
      copy.tone === "danger" ? "border-destructive/30 bg-destructive/10" : copy.tone === "warning" ? "border-warning/30 bg-warning/10" : copy.tone === "success" ? "border-success/30 bg-success/10" : copy.tone === "info" ? "border-info/30 bg-info/10" : "border-border bg-muted/15",
    )}>
      <Icon className={cn("mt-0.5 size-5 shrink-0", copy.tone === "danger" ? "text-destructive" : copy.tone === "warning" ? "text-warning" : copy.tone === "success" ? "text-success" : copy.tone === "info" ? "text-info" : "text-muted-foreground")} aria-hidden />
      <div><h2 className="text-sm font-semibold text-foreground">{copy.title}</h2><p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{copy.message}</p></div>
    </section>
  );
}

function WorkspaceLoading() {
  return <div className="flex min-h-56 items-center justify-center rounded-xl border border-border bg-card text-sm text-muted-foreground" role="status"><Loader2 className="mr-2 size-5 animate-spin" aria-hidden />Loading packet review…</div>;
}

export function ResidentRecordPacketWorkspace({ intakeId }: ResidentRecordPacketWorkspaceProps) {
  const [snapshot, setSnapshot] = useState<ResidentIntakeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const lockRef = useRef(false);
  const requestKeysRef = useRef(new Map<string, string>());

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setLoadError(null);
    try {
      setSnapshot(await loadResidentIntake(intakeId, signal));
    } catch (cause) {
      if (signal?.aborted) return;
      setSnapshot(null);
      setLoadError(cause instanceof Error ? cause.message : "The packet review could not be loaded.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [intakeId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void load(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [load]);

  async function refreshAfter(reply: unknown) {
    const next = normalizeResidentIntakeSnapshot(reply);
    if (next.id === intakeId) setSnapshot(next);
    else await load();
  }

  async function runCommand(command: string, payload: Record<string, unknown>, actionKey: string) {
    if (!snapshot || lockRef.current) return;
    lockRef.current = true;
    setBusyAction(actionKey);
    setActionError(null);
    const requestKey = requestKeysRef.current.get(actionKey) ?? crypto.randomUUID();
    requestKeysRef.current.set(actionKey, requestKey);
    try {
      const reply = await sendResidentIntakeCommand(snapshot, command, payload, requestKey);
      requestKeysRef.current.delete(actionKey);
      await refreshAfter(reply);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "The packet could not be updated. Refresh and try again.");
    } finally {
      lockRef.current = false;
      setBusyAction(null);
    }
  }

  async function runParse(sourceId: string) {
    if (!snapshot || lockRef.current) return;
    const actionKey = `parse:${sourceId}`;
    lockRef.current = true;
    setBusyAction(actionKey);
    setActionError(null);
    const requestKey = requestKeysRef.current.get(actionKey) ?? crypto.randomUUID();
    requestKeysRef.current.set(actionKey, requestKey);
    try {
      const reply = await requestResidentIntakeParse(snapshot, sourceId, requestKey);
      requestKeysRef.current.delete(actionKey);
      await refreshAfter(reply);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "This document could not be reviewed. Retry it or continue manually.");
    } finally {
      lockRef.current = false;
      setBusyAction(null);
    }
  }

  if (loading) return <WorkspaceLoading />;

  if (loadError || !snapshot) {
    return (
      <div className="space-y-4">
        <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-4 text-sm text-destructive">
          <p className="font-semibold">Packet review unavailable</p>
          <p className="mt-1 text-[12px]">{loadError ?? "This packet may be outside your facility access."}</p>
        </div>
        <Button type="button" variant="outline" onClick={() => void load()}><RefreshCcw className="mr-2 size-4" aria-hidden />Try again</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-12">
      <RecordDetailHeader
        title={snapshot.title}
        subtitle={`${snapshot.sources.length} document${snapshot.sources.length === 1 ? "" : "s"} · ${snapshot.residentName ?? "Resident match pending"}`}
        backLink={{ label: "Back to admissions", href: snapshot.admissionCaseId ? `/admin/admissions/${snapshot.admissionCaseId}` : "/admin/admissions" }}
        statusChips={<StatusPill tone={STATE_COPY[snapshot.state].tone}>{STATE_COPY[snapshot.state].title}</StatusPill>}
        actions={snapshot.residentId ? <Link href={`/admin/residents/${snapshot.residentId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>Open resident profile</Link> : undefined}
      />

      <PrimaryState state={snapshot.state} />
      {actionError ? <div role="alert" className="flex items-start justify-between gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-[13px] text-destructive"><span>{actionError}</span><Button type="button" variant="ghost" size="sm" onClick={() => setActionError(null)}>Dismiss</Button></div> : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <main className="min-w-0 space-y-6">
          <RecordDetailSection title="Documents" description="Classify every document before review. Credential holds never enter the resident chart.">
            <PacketSourceList intakeId={snapshot.id} sources={snapshot.sources} busyAction={busyAction} onCommand={runCommand} onParse={runParse} />
          </RecordDetailSection>

          <RecordDetailSection title="Resident match" description="Confirm identity before any proposed fact can be applied.">
            <ResidentMatchReview residentId={snapshot.residentId} residentName={snapshot.residentName} candidates={snapshot.candidates} busyAction={busyAction} onCommand={runCommand} />
          </RecordDetailSection>

          <RecordDetailSection title="Fact review" description="Approval records the review decision. Apply is a separate change to the resident chart.">
            <div className="space-y-4">
              <ManualFactProposal sources={snapshot.sources} busyAction={busyAction} onCommand={runCommand} />
              <FactConflictReview facts={snapshot.facts} permissions={snapshot.permissions} busyAction={busyAction} onCommand={runCommand} />
            </div>
          </RecordDetailSection>
        </main>

        <aside className="space-y-4 xl:sticky xl:top-6 xl:self-start" aria-label="Packet checklist and totals">
          <RecordDetailSection title="Live checklist" description="Counts update after each confirmed action.">
            <IntakeChecklist intakeId={snapshot.id} items={snapshot.checklist} busyAction={busyAction} onCommand={runCommand} />
          </RecordDetailSection>
          <RecordDetailSection title="Packet totals">
            <dl className="grid grid-cols-2 gap-3 text-[12px]">
              {[
                ["Uploaded", snapshot.counts.uploaded],
                ["Resident items", snapshot.counts.residentEligible],
                ["Excluded", snapshot.counts.excluded],
                ["Quarantined", snapshot.counts.quarantined],
                ["Conflicts", snapshot.counts.conflicting],
                ["Awaiting review", snapshot.counts.awaitingReview],
                ["Applied", snapshot.counts.applied],
              ].map(([label, count]) => <div key={String(label)} className="rounded-lg border border-border bg-muted/15 px-3 py-2"><dt className="text-muted-foreground">{label}</dt><dd className="mt-1 text-base font-semibold tabular-nums text-foreground">{count}</dd></div>)}
            </dl>
          </RecordDetailSection>
          {snapshot.state !== "complete" ? (
            <Button type="button" className="w-full" disabled={!snapshot.permissions.canComplete || Boolean(busyAction)} onClick={() => void runCommand("complete_intake", { reason: "Authorized reviewer completed the packet after resolving all required items." }, "complete")}>{busyAction === "complete" ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}Complete packet review</Button>
          ) : null}
          <p className="text-[11px] leading-relaxed text-muted-foreground">Completing this review does not admit the resident, assign a bed, record arrival, or activate medication administration.</p>
        </aside>
      </div>
    </div>
  );
}
