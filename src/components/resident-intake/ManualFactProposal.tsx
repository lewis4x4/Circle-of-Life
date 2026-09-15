"use client";

import { useState } from "react";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import type { ResidentIntakeSource } from "./types";

const MANUAL_FACTS = [
  ["resident.first_name", "First name"],
  ["resident.middle_name", "Middle name"],
  ["resident.last_name", "Last name"],
  ["resident.date_of_birth", "Date of birth"],
  ["resident.gender", "Gender"],
  ["resident.code_status", "Code status"],
  ["resident.diet_order", "Diet order"],
  ["resident.primary_payer", "Primary payer"],
  ["resident.ssn_last_four", "SSN last four"],
] as const;

export type ManualFactProposalProps = {
  sources: ResidentIntakeSource[];
  busyAction: string | null;
  onCommand: (command: string, payload: Record<string, unknown>, actionKey: string) => Promise<void>;
};

export function ManualFactProposal({ sources, busyAction, onCommand }: ManualFactProposalProps) {
  const [sourceId, setSourceId] = useState("");
  const [fieldCode, setFieldCode] = useState("");
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const eligibleSources = sources.filter((source) => source.classification === "resident" && source.state !== "quarantined");

  return (
    <details className="rounded-xl border border-border bg-card p-4">
      <summary className="cursor-pointer text-[13px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">Add a fact manually</summary>
      <p className="mt-2 text-[12px] leading-relaxed text-muted-foreground">Use this when automated review is unavailable. The same separate approval and application steps still apply.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="manual-fact-source">Supporting document</Label>
          <Select value={sourceId || undefined} onValueChange={setSourceId}>
            <SelectTrigger id="manual-fact-source"><SelectValue placeholder="Choose a resident document…" /></SelectTrigger>
            <SelectContent>{eligibleSources.map((source) => <SelectItem key={source.id} value={source.id}>{source.title}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label htmlFor="manual-fact-field">Resident fact</Label>
          <Select value={fieldCode || undefined} onValueChange={setFieldCode}>
            <SelectTrigger id="manual-fact-field"><SelectValue placeholder="Choose a fact…" /></SelectTrigger>
            <SelectContent>{MANUAL_FACTS.map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div className="space-y-2"><Label htmlFor="manual-fact-value">Proposed value</Label><Input id="manual-fact-value" value={value} onChange={(event) => setValue(event.target.value)} /></div>
        <div className="space-y-2"><Label htmlFor="manual-fact-reason">Review note</Label><Input id="manual-fact-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      </div>
      <div className="mt-4 flex justify-end">
        <Button
          type="button"
          variant="outline"
          disabled={!sourceId || !fieldCode || !value.trim() || !reason.trim() || Boolean(busyAction)}
          onClick={() => void onCommand("propose_manual_fact", {
            source_id: sourceId,
            field_code: fieldCode,
            value: value.trim(),
            display_value: value.trim(),
            reason: reason.trim(),
          }, "manual-fact")}
        >
          {busyAction === "manual-fact" ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <Plus className="mr-2 size-4" aria-hidden />}
          Add proposed fact
        </Button>
      </div>
    </details>
  );
}
