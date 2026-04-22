"use client";

import React, { useState } from "react";
import { AlertTriangle, Loader2, FileText } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DiscrepancyRecord {
  id: string;
  medicationName: string;
  countDate: string;
  shift: string;
  expectedCount: number;
  actualCount: number;
  discrepancy: number;
  resolutionNotes?: string | null;
  discrepancyResolved: boolean | null;
}

export interface DiscrepancyResolutionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  discrepancies: DiscrepancyRecord[];
  onResolve: (ids: string[], notes: string) => Promise<void>;
}

export function DiscrepancyResolutionModal({
  open,
  onOpenChange,
  discrepancies,
  onResolve,
}: DiscrepancyResolutionModalProps) {
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const unresolvedIds = discrepancies
        .filter((d) => !d.discrepancyResolved)
        .map((d) => d.id);

      await onResolve(unresolvedIds, resolutionNotes.trim());
      setResolutionNotes("");
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to resolve discrepancies");
    } finally {
      setSubmitting(false);
    }
  };

  const totalDiscrepancy = discrepancies.reduce((sum, d) => sum + d.discrepancy, 0);
  const hasUnresolved = discrepancies.some((d) => !d.discrepancyResolved);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto border-rose-900/50 bg-gradient-to-br from-rose-950/95 via-zinc-950 to-zinc-950 text-zinc-100">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg font-display text-rose-200">
            <AlertTriangle className="h-5 w-5 text-rose-400" />
            Resolve Controlled Substance Discrepancy
          </DialogTitle>
          <DialogDescription className="text-rose-200/70">
            {discrepancies.length === 1
              ? "Document the resolution for this count discrepancy."
              : `Document resolution for ${discrepancies.length} count discrepancies.`}
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-200 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            {error}
          </div>
        )}

        <div className="space-y-4 py-2">
          {/* Discrepancy Summary */}
          <div className="space-y-3 rounded-xl border border-rose-900/35 bg-black/25 p-4">
            <p className="text-xs font-bold uppercase tracking-widest text-rose-200/50">
              Affected Medications
            </p>
            {discrepancies.map((d) => (
              <div
                key={d.id}
                className="flex items-center justify-between py-2 border-b border-rose-900/20 last:border-0 last:pb-0"
              >
                <div>
                  <p className="font-medium text-rose-100">{d.medicationName}</p>
                  <p className="text-xs text-zinc-500">
                    {d.countDate} · {d.shift} shift
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-sm text-zinc-400">
                    Expected: <span className="text-white">{d.expectedCount}</span>
                  </p>
                  <p className="text-sm text-zinc-400">
                    Actual: <span className="text-white">{d.actualCount}</span>
                  </p>
                  <p className="font-mono font-bold text-rose-400">
                    Delta: {d.discrepancy > 0 ? "+" : ""}{d.discrepancy}
                  </p>
                </div>
              </div>
            ))}
            <div className="pt-2 border-t border-rose-900/30 flex justify-between items-center">
              <span className="text-sm text-zinc-400">Total Discrepancy</span>
              <span className={`font-mono font-bold text-lg ${totalDiscrepancy === 0 ? "text-emerald-400" : "text-rose-400"}`}>
                {totalDiscrepancy > 0 ? "+" : ""}{totalDiscrepancy}
              </span>
            </div>
          </div>

          {/* Resolution Notes */}
          <div className="space-y-2">
            <Label className="text-xs text-rose-200/80">
              Resolution Notes <span className="text-rose-400">*</span>
            </Label>
            <textarea
              rows={4}
              value={resolutionNotes}
              onChange={(e) => setResolutionNotes(e.target.value)}
              placeholder="Describe the root cause and resolution (e.g., 'Dose given but not documented — eMAR updated', 'Pill dropped — witnessed destruction', 'Count error — recount confirmed balance')"
              className="w-full rounded-lg border border-rose-900/50 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:ring-2 focus:ring-rose-500/50 resize-none"
            />
            <p className="text-xs text-zinc-500">
              This documentation is required for regulatory compliance.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="flex-1 border-zinc-700 text-zinc-300 hover:bg-zinc-800"
            disabled={submitting}
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !hasUnresolved || !resolutionNotes.trim()}
            className="flex-1 bg-rose-700 text-white hover:bg-rose-600 disabled:opacity-50"
          >
            {submitting ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Resolving...
              </>
            ) : (
              <>
                <FileText className="mr-2 h-4 w-4" />
                Mark Resolved
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
