"use client";

import Link from "next/link";
import { Loader2, Plus, RefreshCcw } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";

import type { ResidentIntakeChecklistItem } from "./types";
import { humanizeToken } from "./ui-labels";

export type IntakeChecklistProps = {
  intakeId: string;
  items: ResidentIntakeChecklistItem[];
  busyAction: string | null;
  onCommand: (command: string, payload: Record<string, unknown>, actionKey: string) => Promise<void>;
};

const STATUS_ORDER = ["conflicting", "quarantined", "unreadable", "missing", "awaiting_review", "present", "reviewed", "applied", "excluded"];

function tone(status: string): "muted" | "success" | "warning" | "danger" | "info" {
  if (["conflicting", "quarantined", "unreadable"].includes(status)) return "danger";
  if (["missing", "awaiting_review"].includes(status)) return "warning";
  if (status === "applied") return "success";
  if (["present", "reviewed"].includes(status)) return "info";
  return "muted";
}

export function IntakeChecklist({ intakeId, items, busyAction, onCommand }: IntakeChecklistProps) {
  const ordered = [...items].sort((left, right) => {
    const leftOrder = STATUS_ORDER.indexOf(left.status);
    const rightOrder = STATUS_ORDER.indexOf(right.status);
    return (leftOrder < 0 ? 99 : leftOrder) - (rightOrder < 0 ? 99 : rightOrder) || left.label.localeCompare(right.label);
  });

  if (ordered.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
        <p className="text-[13px] font-medium text-foreground">Checklist not available yet</p>
        <p className="mt-1 text-[12px] text-muted-foreground">Classify resident documents to build the live packet checklist.</p>
      </div>
    );
  }

  return (
    <ul className="space-y-2" aria-label="Resident packet checklist">
      {ordered.map((item) => {
        const addAction = `add:${item.key}`;
        const replaceAction = `replace:${item.key}`;
        const uploadHref = `/admin/admissions/new?tab=packet&intake=${encodeURIComponent(intakeId)}&document_type=${encodeURIComponent(item.key)}`;
        return (
          <li key={item.key} className="rounded-lg border border-border bg-card px-3 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[13px] font-medium text-foreground">{item.label}</p>
                <p className="mt-1 text-[11px] text-muted-foreground">{item.count} packet item{item.count === 1 ? "" : "s"}</p>
              </div>
              <StatusPill tone={tone(item.status)}>{humanizeToken(item.status)}</StatusPill>
            </div>
            {item.canAdd || item.canReplace || item.status === "missing" || Boolean(item.currentDocumentId) ? (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3">
                {item.canAdd ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!item.sourceId || Boolean(busyAction)}
                    onClick={() => {
                      if (!item.sourceId) return;
                      void onCommand("promote_source", {
                        source_id: item.sourceId,
                        mode: "add",
                        reason: `Reviewer added ${item.label} to the resident chart.`,
                      }, addAction);
                    }}
                  >
                    {busyAction === addAction ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : <Plus className="mr-1.5 size-3.5" aria-hidden />}
                    Add to chart
                  </Button>
                ) : null}
                {item.canReplace ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!item.currentDocumentId || Boolean(busyAction)}
                    onClick={() => {
                      if (!item.sourceId || !item.currentDocumentId) return;
                      void onCommand("promote_source", {
                        source_id: item.sourceId,
                        mode: "replace",
                        resident_document_id: item.currentDocumentId,
                        reason: `Reviewer replaced the current ${item.label}.`,
                      }, replaceAction);
                    }}
                  >
                    {busyAction === replaceAction ? <Loader2 className="mr-1.5 size-3.5 animate-spin" aria-hidden /> : <RefreshCcw className="mr-1.5 size-3.5" aria-hidden />}
                    Replace
                  </Button>
                ) : null}
                {!item.sourceId || item.currentDocumentId ? (
                  <Link href={uploadHref} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                    {item.currentDocumentId ? "Upload replacement" : "Add document"}
                  </Link>
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
