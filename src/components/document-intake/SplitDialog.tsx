"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";

import { FIELD_CLASS } from "./IntakeDialogs";
import { PdfPageCanvas, type PdfState } from "./SourcePreview";
import { assignmentFromSegments, checkSplit, removePart, type PageAssignment, type SplitPart, type SplitPlan } from "./split";

export function SplitDialog({
  open,
  onOpenChange,
  pdf,
  pageCount,
  segments,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pdf: PdfState;
  pageCount: number;
  /** Reader-proposed segmentation, used only as a starting layout. */
  segments: ReadonlyArray<{ pages: number[]; title: string | null }>;
  onSubmit: (plan: SplitPlan) => Promise<string | null>;
}) {
  const [parts, setParts] = useState<SplitPart[]>([]);
  const [assignment, setAssignment] = useState<PageAssignment>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (segments.length > 1) {
      setParts(segments.map((s) => ({ title: s.title ?? "" })));
      setAssignment(assignmentFromSegments(pageCount, segments));
    } else {
      setParts([{ title: "" }, { title: "" }]);
      setAssignment({});
    }
    setError(null);
    setAttempted(false);
  }, [open, segments, pageCount]);

  const check = useMemo(() => checkSplit(pageCount, parts, assignment), [pageCount, parts, assignment]);
  const unplaced = Array.from({ length: pageCount }, (_, i) => i + 1).filter((p) => assignment[p] === undefined);

  function setPage(page: number, value: string) {
    setAssignment((current) => {
      const next = { ...current };
      if (value === "") delete next[page];
      else next[page] = value === "excluded" ? "excluded" : Number(value);
      return next;
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <form
          className="grid gap-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setAttempted(true);
            if (!check.ok) return;
            setBusy(true);
            setError(await onSubmit(check.plan));
            setBusy(false);
          }}
        >
          <DialogHeader>
            <DialogTitle>Split pages</DialogTitle>
            <DialogDescription>
              Each part becomes its own document. Put every page in a part or exclude it. The original is kept.
            </DialogDescription>
          </DialogHeader>

          <fieldset className="grid gap-2">
            <legend className="mb-1 text-sm font-semibold text-foreground">Parts</legend>
            {parts.map((part, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="grid flex-1 gap-1">
                  <FormLabel htmlFor={`split-part-${index}`}>Part {index + 1} title (optional)</FormLabel>
                  <Input
                    id={`split-part-${index}`}
                    value={part.title}
                    maxLength={200}
                    onChange={(e) => setParts((current) => current.map((p, i) => (i === index ? { title: e.target.value } : p)))}
                  />
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  disabled={parts.length <= 1}
                  aria-label={`Remove part ${index + 1}`}
                  onClick={() => {
                    setParts((current) => current.filter((_, i) => i !== index));
                    setAssignment((current) => removePart(current, index));
                  }}
                >
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            ))}
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" disabled={parts.length >= 50} onClick={() => setParts((current) => [...current, { title: "" }])}>
                <Plus className="size-3.5" aria-hidden />
                Add part
              </Button>
              {unplaced.length > 0 && parts.length > 0 ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setAssignment((current) => {
                      const next = { ...current };
                      for (const page of unplaced) next[page] = parts.length - 1;
                      return next;
                    })
                  }
                >
                  Put unplaced pages in part {parts.length}
                </Button>
              ) : null}
            </div>
          </fieldset>

          <fieldset>
            <legend className="mb-2 text-sm font-semibold text-foreground">Pages</legend>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((page) => {
                const value = assignment[page];
                return (
                  <li key={page} className="grid gap-1 rounded-md border border-border p-2">
                    {pdf.doc ? (
                      <PdfPageCanvas doc={pdf.doc} pageNumber={page} cssWidth={160} label={`Page ${page} preview`} />
                    ) : (
                      <div className="flex aspect-[3/4] items-center justify-center bg-muted/30 text-xs text-muted-foreground">Page {page}</div>
                    )}
                    <label htmlFor={`split-page-${page}`} className="text-xs font-medium text-foreground">
                      Page {page}
                    </label>
                    <select
                      id={`split-page-${page}`}
                      className={FIELD_CLASS}
                      value={value === undefined ? "" : String(value)}
                      onChange={(e) => setPage(page, e.target.value)}
                      aria-invalid={attempted && value === undefined ? true : undefined}
                    >
                      <option value="">Not placed</option>
                      {parts.map((_, index) => (
                        <option key={index} value={index}>
                          Part {index + 1}
                        </option>
                      ))}
                      <option value="excluded">Exclude</option>
                    </select>
                  </li>
                );
              })}
            </ol>
          </fieldset>

          {attempted && !check.ok ? (
            <ul role="alert" className="list-disc space-y-1 pl-5 text-sm text-destructive">
              {check.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          ) : null}
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button type="submit" disabled={busy}>
              {busy ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
              Split into {parts.length} {parts.length === 1 ? "part" : "parts"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
