"use client";

import { useState } from "react";
import { Check, Loader2, Pencil, RotateCcw, ShieldCheck, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusPill } from "@/components/ui/status-pill";
import { Textarea } from "@/components/ui/textarea";

import type { ResidentIntakeFact, ResidentIntakePermissions } from "./types";
import { humanizeToken } from "./ui-labels";

export type FactConflictReviewProps = {
  facts: ResidentIntakeFact[];
  permissions: ResidentIntakePermissions;
  busyAction: string | null;
  onCommand: (command: string, payload: Record<string, unknown>, actionKey: string) => Promise<void>;
};

function canApply(fact: ResidentIntakeFact, permissions: ResidentIntakePermissions): boolean {
  if (fact.allowedActions.length) return fact.allowedActions.includes("apply_fact");
  if (fact.domain === "clinical") return permissions.canApplyClinical;
  if (["payer", "pharmacy_benefit"].includes(fact.domain)) return permissions.canApplyPayer;
  if (["legal", "authority", "contract"].includes(fact.domain)) return permissions.canApplyAuthority;
  return permissions.canReview;
}

function canReviewFact(fact: ResidentIntakeFact, permissions: ResidentIntakePermissions): boolean {
  return fact.allowedActions.length
    ? fact.allowedActions.some((action) => ["approve_fact", "reject_fact", "correct_fact"].includes(action))
    : permissions.canReview;
}

function factTone(fact: ResidentIntakeFact): "muted" | "success" | "warning" | "danger" | "info" {
  if (fact.stale || fact.conflict || fact.state === "rejected") return "danger";
  if (fact.state === "applied") return "success";
  if (fact.state === "approved") return "info";
  if (["proposed", "corrected"].includes(fact.state)) return "warning";
  return "muted";
}

function confidenceLabel(confidence: number | null): string {
  if (confidence == null) return "Not scored";
  const value = confidence <= 1 ? confidence * 100 : confidence;
  return `${Math.round(value)}%`;
}

function correctionValue(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function FactRow({ fact, permissions, busyAction, onCommand }: Omit<FactConflictReviewProps, "facts"> & { fact: ResidentIntakeFact }) {
  const [editing, setEditing] = useState(false);
  const [correction, setCorrection] = useState(fact.proposedValue === "Not reviewed" ? "" : fact.proposedValue);
  const [reason, setReason] = useState("");
  const reviewAllowed = canReviewFact(fact, permissions);
  const applyAllowed = canApply(fact, permissions);

  function payload(extra: Record<string, unknown> = {}) {
    return { fact_id: fact.id, fact_revision: fact.revision, ...extra };
  }

  return (
    <article className="rounded-xl border border-border bg-card p-4 shadow-[var(--shadow-card)]">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{fact.label}</h3>
          <p className="mt-1 text-[11px] text-muted-foreground">{humanizeToken(fact.domain)} · Reviewer: {humanizeToken(fact.requiredReviewer)}</p>
        </div>
        <StatusPill tone={factTone(fact)}>{fact.stale ? "Changed since review" : fact.conflict ? "Conflict" : humanizeToken(fact.state)}</StatusPill>
      </div>

      <dl className="mt-4 grid gap-4 md:grid-cols-4">
        <div><dt className="text-[11px] font-semibold text-muted-foreground">Current</dt><dd className="mt-1 break-words text-[13px] text-foreground">{fact.currentValue}</dd></div>
        <div><dt className="text-[11px] font-semibold text-muted-foreground">Proposed</dt><dd className="mt-1 break-words text-[13px] font-medium text-foreground">{fact.proposedValue}</dd></div>
        <div><dt className="text-[11px] font-semibold text-muted-foreground">Source</dt><dd className="mt-1 break-words text-[13px] text-foreground">{fact.sourceLabel}{fact.pageNumber ? ` · page ${fact.pageNumber}` : ""}</dd></div>
        <div><dt className="text-[11px] font-semibold text-muted-foreground">Confidence</dt><dd className="mt-1 text-[13px] text-foreground">{confidenceLabel(fact.confidence)}</dd></div>
      </dl>

      {fact.stale ? <p role="alert" className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">The resident chart changed after this review. Review the current value again before applying.</p> : null}

      {editing ? (
        <div className="mt-4 grid gap-3 rounded-lg border border-border bg-muted/15 p-3 md:grid-cols-2">
          <div className="space-y-2"><Label htmlFor={`correction-${fact.id}`}>Corrected value or JSON</Label><Textarea id={`correction-${fact.id}`} value={correction} onChange={(event) => setCorrection(event.target.value)} rows={3} /></div>
          <div className="space-y-2"><Label htmlFor={`correction-reason-${fact.id}`}>Correction reason</Label><Input id={`correction-reason-${fact.id}`} value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          <div className="flex justify-end gap-2 md:col-span-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setEditing(false)} disabled={Boolean(busyAction)}>Cancel</Button>
            <Button
              type="button"
              size="sm"
              disabled={!correction.trim() || !reason.trim() || Boolean(busyAction)}
              onClick={() => void onCommand("correct_fact", payload({ field_code: fact.fieldCode, value: correctionValue(correction.trim()), display_value: correction.trim(), reason: reason.trim() }), `correct:${fact.id}`)}
            >
              {busyAction === `correct:${fact.id}` ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : <Check className="mr-1.5 size-3.5" aria-hidden />}
              Save correction
            </Button>
          </div>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap justify-end gap-2 border-t border-border pt-3">
        {reviewAllowed && ["proposed", "corrected", "stale", "stale_target"].includes(fact.state) ? (
          <>
            <Button type="button" variant="ghost" size="sm" disabled={Boolean(busyAction)} onClick={() => setEditing(true)}><Pencil className="mr-1.5 size-3.5" aria-hidden />Correct</Button>
            <Button type="button" variant="outline" size="sm" disabled={Boolean(busyAction)} onClick={() => void onCommand("reject_fact", payload({ reason: "Reviewer rejected the proposed value." }), `reject:${fact.id}`)}>
              {busyAction === `reject:${fact.id}` ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : <X className="mr-1.5 size-3.5" aria-hidden />}Reject
            </Button>
            <Button type="button" variant="outline" size="sm" disabled={fact.conflict || fact.stale || !fact.canonicalFingerprint || Boolean(busyAction)} onClick={() => void onCommand("approve_fact", payload({ canonical_fingerprint: fact.canonicalFingerprint, reason: "Reviewer confirmed the proposed value against the supporting document." }), `approve:${fact.id}`)}>
              {busyAction === `approve:${fact.id}` ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : <ShieldCheck className="mr-1.5 size-3.5" aria-hidden />}Approve
            </Button>
          </>
        ) : null}
        {fact.state === "approved" ? (
          <Button type="button" size="sm" disabled={!applyAllowed || !fact.canonicalFingerprint || Boolean(busyAction)} onClick={() => void onCommand("apply_fact", payload({ canonical_fingerprint: fact.canonicalFingerprint, reason: "Authorized reviewer applied the approved value to the resident chart." }), `apply:${fact.id}`)}>
            {busyAction === `apply:${fact.id}` ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : <RotateCcw className="mr-1.5 size-3.5" aria-hidden />}
            Apply to resident chart
          </Button>
        ) : null}
      </div>
      {fact.state === "approved" && !applyAllowed ? <p className="mt-2 text-right text-[11px] text-muted-foreground">Approval recorded. A reviewer with the required authority must apply this value.</p> : null}
    </article>
  );
}

export function FactConflictReview({ facts, permissions, busyAction, onCommand }: FactConflictReviewProps) {
  if (facts.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center">
        <p className="text-sm font-semibold text-foreground">No proposed facts yet</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Classify and review a resident document, or add a controlled fact manually.</p>
      </div>
    );
  }
  return <div className="space-y-3">{facts.map((fact) => <FactRow key={`${fact.id}:${fact.revision}`} fact={fact} permissions={permissions} busyAction={busyAction} onCommand={onCommand} />)}</div>;
}
