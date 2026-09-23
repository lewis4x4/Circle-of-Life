"use client";

import { formatDisplayDate } from "@/lib/format/datetime";
import { useState } from "react";
import { Loader2, UserCheck, UserPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import type { ResidentIntakeCandidate } from "./types";
import { humanizeToken } from "./ui-labels";

export type ResidentMatchReviewProps = {
  residentId: string | null;
  residentName: string | null;
  candidates: ResidentIntakeCandidate[];
  busyAction: string | null;
  onCommand: (command: string, payload: Record<string, unknown>, actionKey: string) => Promise<void>;
};

function dateLabel(value: string | null): string {
  if (!value) return "DOB not posted";
  return formatDisplayDate(value.slice(0, 10), { fallback: value });
}

export function ResidentMatchReview({ residentId, residentName, candidates, busyAction, onCommand }: ResidentMatchReviewProps) {
  const [reasonByCandidate, setReasonByCandidate] = useState<Record<string, string>>({});
  const [dispositionByCandidate, setDispositionByCandidate] = useState<Record<string, string>>({});
  const [firstName, setFirstName] = useState("");
  const [middleName, setMiddleName] = useState("");
  const [lastName, setLastName] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [gender, setGender] = useState("");
  const [duplicateDisposition, setDuplicateDisposition] = useState("");
  const [createReason, setCreateReason] = useState("");

  if (residentId) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-muted/15 px-4 py-3">
        <div>
          <p className="text-[12px] text-muted-foreground">Packet linked to</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{residentName ?? "Resident profile"}</p>
        </div>
        <StatusPill tone="success">Match confirmed</StatusPill>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Confirm an existing resident</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">Names and dates are evidence only. Choose a resident deliberately; Haven will not link a candidate automatically.</p>
      </div>

      {candidates.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
          <p className="text-[13px] font-medium text-foreground">No eligible resident candidates</p>
          <p className="mt-1 text-[12px] text-muted-foreground">Create an inquiry-only profile below after recording how duplicate risk was checked.</p>
        </div>
      ) : (
        <div className="space-y-3" role="list" aria-label="Resident candidates">
          {candidates.map((candidate) => {
            const actionKey = `match:${candidate.id}`;
            const reason = reasonByCandidate[candidate.id] ?? "";
            const disposition = dispositionByCandidate[candidate.id] ?? "";
            return (
              <div key={candidate.id} role="listitem" className="rounded-lg border border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{candidate.name}</p>
                    <p className="mt-1 text-[12px] text-muted-foreground">
                      {dateLabel(candidate.dateOfBirth)} · {candidate.facilityName ?? "Facility not posted"} · {humanizeToken(candidate.status)}
                    </p>
                  </div>
                  {candidate.matchKind ? <StatusPill tone={candidate.matchKind.includes("cross") ? "warning" : "muted"}>{humanizeToken(candidate.matchKind)}</StatusPill> : null}
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,auto)_auto] md:items-end">
                  <div className="space-y-2">
                    <Label htmlFor={`match-reason-${candidate.id}`}>Confirmation reason</Label>
                    <Input
                      id={`match-reason-${candidate.id}`}
                      value={reason}
                      onChange={(event) => setReasonByCandidate((current) => ({ ...current, [candidate.id]: event.target.value }))}
                      placeholder="How did you confirm this is the intended resident?"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={`match-disposition-${candidate.id}`}>Duplicate disposition</Label>
                    <Select value={disposition || undefined} onValueChange={(value) => setDispositionByCandidate((current) => ({ ...current, [candidate.id]: value }))}>
                      <SelectTrigger id={`match-disposition-${candidate.id}`}><SelectValue placeholder="Choose disposition…" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="confirmed_match">Confirmed intended resident</SelectItem>
                        <SelectItem value="cross_facility_not_transfer">Cross-facility record; not a transfer</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!candidate.residentId || !reason.trim() || !disposition || Boolean(busyAction)}
                    onClick={() => void onCommand("confirm_resident_match", {
                      match_id: candidate.id,
                      resident_id: candidate.residentId,
                      candidate_id: candidate.id,
                      duplicate_disposition: disposition,
                      reason: reason.trim(),
                    }, actionKey)}
                  >
                    {busyAction === actionKey ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <UserCheck className="mr-2 size-4" aria-hidden />}
                    Confirm resident
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="border-t border-border pt-5">
        <div className="mb-4">
          <h3 className="text-sm font-semibold text-foreground">Create a provisional inquiry resident</h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">This creates an inquiry profile only. It does not admit the resident, occupy a bed, or mark clinical and payer facts reviewed.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2"><Label htmlFor="packet-first-name">First name</Label><Input id="packet-first-name" value={firstName} onChange={(event) => setFirstName(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="packet-middle-name">Middle name <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="packet-middle-name" value={middleName} onChange={(event) => setMiddleName(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="packet-last-name">Last name</Label><Input id="packet-last-name" value={lastName} onChange={(event) => setLastName(event.target.value)} /></div>
          <div className="space-y-2"><Label htmlFor="packet-dob">Date of birth <span className="font-normal text-muted-foreground">(optional)</span></Label><Input id="packet-dob" type="date" value={dateOfBirth} onChange={(event) => setDateOfBirth(event.target.value)} /></div>
          <div className="space-y-2">
            <Label htmlFor="packet-gender">Gender <span className="font-normal text-muted-foreground">(optional)</span></Label>
            <Select value={gender || undefined} onValueChange={setGender}>
              <SelectTrigger id="packet-gender"><SelectValue placeholder="Not reviewed" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="female">Female</SelectItem><SelectItem value="male">Male</SelectItem><SelectItem value="non_binary">Non-binary</SelectItem><SelectItem value="other">Other</SelectItem><SelectItem value="prefer_not_to_say">Prefer not to say</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="packet-duplicate-disposition">Duplicate review</Label>
            <Select value={duplicateDisposition || undefined} onValueChange={setDuplicateDisposition}>
              <SelectTrigger id="packet-duplicate-disposition"><SelectValue placeholder="Choose disposition…" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="no_match">No matching resident after review</SelectItem>
                <SelectItem value="not_same_person">Candidates are not the same person</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 sm:col-span-2"><Label htmlFor="packet-create-reason">Reason</Label><Input id="packet-create-reason" value={createReason} onChange={(event) => setCreateReason(event.target.value)} placeholder="Record why a new inquiry profile is appropriate." /></div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            disabled={!firstName.trim() || !lastName.trim() || !duplicateDisposition || !createReason.trim() || Boolean(busyAction)}
            onClick={() => void onCommand("create_provisional_resident", {
              first_name: firstName.trim(),
              middle_name: middleName.trim() || null,
              last_name: lastName.trim(),
              date_of_birth: dateOfBirth || null,
              gender: gender || null,
              duplicate_disposition: duplicateDisposition,
              reason: createReason.trim(),
            }, "create-resident")}
          >
            {busyAction === "create-resident" ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : <UserPlus className="mr-2 size-4" aria-hidden />}
            Create inquiry resident
          </Button>
        </div>
      </div>
    </div>
  );
}
