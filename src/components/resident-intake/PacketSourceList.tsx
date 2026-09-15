"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileText, Loader2, LockKeyhole, ScanSearch } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

import type { ResidentIntakeSource } from "./types";
import { RESIDENT_DOCUMENT_TYPES, SOURCE_CLASSIFICATIONS, humanizeToken } from "./ui-labels";

export type PacketSourceListProps = {
  intakeId: string;
  sources: ResidentIntakeSource[];
  busyAction: string | null;
  onCommand: (command: string, payload: Record<string, unknown>, actionKey: string) => Promise<void>;
  onParse: (sourceId: string) => Promise<void>;
};

function sourceTone(source: ResidentIntakeSource): "muted" | "success" | "warning" | "danger" | "info" {
  if (source.state === "quarantined" || source.classification === "credential_secret") return "danger";
  if (source.failureMessage || source.state.includes("failed")) return "danger";
  if (source.residentDocumentId) return "success";
  if (!source.classification || source.requiresSafetyConfirmation && !source.safetyConfirmed) return "warning";
  if (source.classification === "resident") return "info";
  return "muted";
}

function sourceStatus(source: ResidentIntakeSource): string {
  if (source.state === "quarantined" || source.classification === "credential_secret") return "Quarantined";
  if (source.failureMessage || source.state.includes("failed")) return "Needs attention";
  if (source.residentDocumentId) return "Added to chart";
  if (!source.classification) return "Classification needed";
  if (source.requiresSafetyConfirmation && !source.safetyConfirmed) return "Preview check needed";
  return humanizeToken(source.state);
}

function formatBytes(bytes: number | null): string {
  if (bytes == null) return "Size not posted";
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function SourceReviewControls({
  source,
  busyAction,
  onCommand,
  onParse,
}: Omit<PacketSourceListProps, "sources" | "intakeId"> & { source: ResidentIntakeSource }) {
  const [classification, setClassification] = useState(source.classification ?? "");
  const [documentType, setDocumentType] = useState(source.documentType ?? "");
  const [reason, setReason] = useState("");
  const classificationAction = `classify:${source.id}`;
  const safetyAction = `safety:${source.id}`;
  const parseAction = `parse:${source.id}`;
  const quarantined = source.state === "quarantined" || source.classification === "credential_secret";
  const excluded = ["facility", "employee", "other_resident", "unreadable", "unsupported"].includes(source.classification ?? "");

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`classification-${source.id}`}>Document belongs to</Label>
          <Select value={classification || undefined} onValueChange={setClassification} disabled={Boolean(busyAction)}>
            <SelectTrigger id={`classification-${source.id}`}>
              <SelectValue placeholder="Choose classification…" />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_CLASSIFICATIONS.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`document-type-${source.id}`}>Resident document type</Label>
          <Select
            value={documentType || undefined}
            onValueChange={setDocumentType}
            disabled={classification !== "resident" || Boolean(busyAction)}
          >
            <SelectTrigger id={`document-type-${source.id}`}>
              <SelectValue placeholder={classification === "resident" ? "Choose document type…" : "Resident documents only"} />
            </SelectTrigger>
            <SelectContent>
              {RESIDENT_DOCUMENT_TYPES.map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-end">
        <div className="space-y-2">
          <Label htmlFor={`classification-reason-${source.id}`}>Review reason</Label>
          <input
            id={`classification-reason-${source.id}`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="What in the document supports this choice?"
            className="min-h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={!classification || !reason.trim() || classification === "resident" && !documentType || Boolean(busyAction)}
          onClick={() => void onCommand("manual_classify_source", {
            source_id: source.id,
            classification,
            document_class: classification === "resident" ? documentType : null,
            reason: reason.trim(),
          }, classificationAction)}
        >
          {busyAction === classificationAction ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
          Record classification
        </Button>
      </div>

      {!quarantined && !excluded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-3 py-3">
          <p className="max-w-xl text-[12px] leading-relaxed text-muted-foreground">
            {source.requiresSafetyConfirmation && !source.safetyConfirmed
              ? "Review the preview and confirm it contains no passwords, access tokens, recovery codes, or private keys before automated review."
              : "This document is cleared for the next review step."}
          </p>
          <div className="flex flex-wrap gap-2">
            {source.requiresSafetyConfirmation && !source.safetyConfirmed ? (
              <Button
                type="button"
                variant="outline"
                disabled={Boolean(busyAction)}
                onClick={() => void onCommand("confirm_source_safe_for_external_parse", {
                  source_id: source.id,
                  reason: "Authorized reviewer checked the document preview for credentials.",
                }, safetyAction)}
              >
                {busyAction === safetyAction ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <LockKeyhole className="mr-2 size-4" aria-hidden />}
                Confirm preview is clear
              </Button>
            ) : null}
            <Button
              type="button"
              disabled={source.classification !== null && source.classification !== "resident" || source.requiresSafetyConfirmation && !source.safetyConfirmed || Boolean(busyAction)}
              onClick={() => void onParse(source.id)}
            >
              {busyAction === parseAction ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <ScanSearch className="mr-2 size-4" aria-hidden />}
              {source.state === "parse_failed"
                ? "Retry document review"
                : source.classification
                  ? "Review document"
                  : "Classify and review"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function PacketSourceList({ intakeId, sources, busyAction, onCommand, onParse }: PacketSourceListProps) {
  if (sources.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
        <FileText className="mx-auto size-8 text-muted-foreground" aria-hidden />
        <p className="mt-3 text-sm font-semibold text-foreground">No documents in this packet</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Return to New admission case to add the first documents.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {sources.map((source) => {
        const quarantined = source.state === "quarantined" || source.classification === "credential_secret";
        return (
          <article key={source.id} className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 items-start gap-3">
                {quarantined ? <AlertTriangle className="mt-0.5 size-5 shrink-0 text-destructive" aria-hidden /> : source.residentDocumentId ? <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-success" aria-hidden /> : <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />}
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-semibold text-foreground">{source.title}</h3>
                  <p className="mt-1 text-[11px] text-muted-foreground">{formatBytes(source.sizeBytes)} · {source.mimeType ?? "File format not posted"}</p>
                  {source.documentType ? <p className="mt-1 text-[12px] text-foreground">{humanizeToken(source.documentType)}</p> : null}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <StatusPill tone={sourceTone(source)}>{sourceStatus(source)}</StatusPill>
                <a
                  href={`/api/admin/resident-record-intakes/${encodeURIComponent(intakeId)}/sources/${encodeURIComponent(source.id)}/download`}
                  className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }))}
                  aria-label={`Open ${source.title}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download className="size-4" aria-hidden />
                </a>
              </div>
            </div>
            {source.failureMessage ? <p role="alert" className="mt-3 text-[12px] text-destructive">{source.failureMessage}</p> : null}
            {quarantined ? (
              <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-3">
                <p className="text-[12px] font-semibold text-destructive">Held away from resident records</p>
                <p className="mt-1 text-[12px] leading-relaxed text-destructive">This document will not be sent for automated review or added to the resident chart. {source.quarantineReason ? `Reason: ${humanizeToken(source.quarantineReason)}.` : "An owner or organization administrator must review the hold."}</p>
              </div>
            ) : (
              <SourceReviewControls source={source} busyAction={busyAction} onCommand={onCommand} onParse={onParse} />
            )}
          </article>
        );
      })}
    </div>
  );
}
