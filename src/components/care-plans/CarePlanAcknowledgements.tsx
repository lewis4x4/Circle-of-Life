"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { SignaturePad } from "@/components/ui/signature-pad";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  CARE_PLAN_ACK_METHODS,
  CARE_PLAN_ACK_METHOD_LABELS,
  CARE_PLAN_ACK_NONE_COPY,
  CARE_PLAN_ACK_ONLY_ACTIVE_COPY,
  CARE_PLAN_ACK_ROLE_LABELS,
  CARE_PLAN_ACK_SIGNER_ROLES,
  formatCarePlanAckMethod,
  formatCarePlanAckRole,
  formatCarePlanAckSigner,
  type CarePlanAckMethod,
  type CarePlanAckSignerRole,
} from "@/lib/care-plans/care-plan-acknowledgement-copy";
import { formatCarePlanPrintTimestamp } from "@/lib/care-plans/care-plan-print-copy";
import { createClient } from "@/lib/supabase/client";
import { RecordDetailSection } from "@/design-system/components/record-detail";

export type CarePlanAcknowledgementRow = {
  id: string;
  signer_role: string;
  signer_name: string;
  relationship_to_resident: string | null;
  method: string;
  signature_data: string | null;
  acknowledged_at: string;
  notes: string | null;
};

const RECORDER_ROLES = ["owner", "org_admin", "facility_admin", "med_tech"];

/**
 * Who, besides staff, has seen the signed plan. Rows are evidence: append-only,
 * recorded only against the active version.
 */
export function CarePlanAcknowledgements({ planId, planStatus }: { planId: string; planStatus: string | null }) {
  const { appRole } = useHavenAuth();
  const client = useMemo(() => createClient(), []);
  const [rows, setRows] = useState<CarePlanAcknowledgementRow[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signerRole, setSignerRole] = useState<CarePlanAckSignerRole>("resident");
  const [signerName, setSignerName] = useState("");
  const [relationship, setRelationship] = useState("");
  const [method, setMethod] = useState<CarePlanAckMethod>("in_person_signature");
  const [signature, setSignature] = useState<string | null>(null);
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const result = (await client
      .from("care_plan_acknowledgements" as never)
      .select("id, signer_role, signer_name, relationship_to_resident, method, signature_data, acknowledged_at, notes")
      .eq("care_plan_id", planId)
      .is("deleted_at", null)
      .order("acknowledged_at", { ascending: false })) as unknown as { data: CarePlanAcknowledgementRow[] | null; error: { message: string } | null };
    if (result.error) {
      setLoadError(result.error.message);
      return;
    }
    setLoadError(null);
    setRows(result.data ?? []);
  }, [client, planId]);

  useEffect(() => {
    void load();
  }, [load]);

  const canRecord = planStatus === "active" && RECORDER_ROLES.includes(appRole ?? "");
  const needsSignature = method === "in_person_signature";
  const ready = signerName.trim().length >= 2 && (!needsSignature || Boolean(signature));

  async function save() {
    if (busy || !ready) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/care-plans/${planId}/acknowledgements`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signer_role: signerRole,
          signer_name: signerName,
          relationship_to_resident: relationship,
          method,
          signature_data: needsSignature ? signature : null,
          notes,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error || "Acknowledgement could not be recorded");
      }
      setOpen(false);
      setSignerName("");
      setRelationship("");
      setNotes("");
      setSignature(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Acknowledgement could not be recorded");
    } finally {
      setBusy(false);
    }
  }

  return (
    <RecordDetailSection
      title="Resident / representative acknowledgement"
      description={planStatus === "active" ? "Who has reviewed the signed plan" : CARE_PLAN_ACK_ONLY_ACTIVE_COPY}
      action={canRecord && !open ? <Button size="sm" variant="outline" onClick={() => setOpen(true)}>Record acknowledgement</Button> : null}
    >
      {loadError ? <p role="alert" className="text-sm text-destructive">{loadError}</p> : null}
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{CARE_PLAN_ACK_NONE_COPY}</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row) => (
            <li key={row.id} className="flex flex-wrap items-end justify-between gap-3 rounded-[8px] border border-border bg-muted p-[14px] text-sm">
              <div>
                <p className="font-medium text-foreground">
                  {formatCarePlanAckRole(row.signer_role)} · {formatCarePlanAckSigner(row.signer_name, row.relationship_to_resident)}
                </p>
                <p className="text-xs text-muted-foreground">{formatCarePlanAckMethod(row.method)} · {formatCarePlanPrintTimestamp(row.acknowledged_at)}</p>
                {row.notes ? <p className="mt-1 text-xs text-foreground">{row.notes}</p> : null}
              </div>
              {row.signature_data ? (
                // eslint-disable-next-line @next/next/no-img-element -- inline data URL captured at acknowledgement
                <img src={row.signature_data} alt={`${formatCarePlanAckRole(row.signer_role)} signature`} className="h-12 max-w-[200px] border-b border-border" />
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {open ? (
        <fieldset disabled={busy} className="mt-4 space-y-3 rounded border border-border p-4">
          <legend className="text-sm font-semibold">New acknowledgement</legend>
          <label className="block text-sm">Who
            <select value={signerRole} onChange={(e) => setSignerRole(e.target.value as CarePlanAckSignerRole)} className="mt-1 block w-full rounded border p-2">
              {CARE_PLAN_ACK_SIGNER_ROLES.map((role) => <option key={role} value={role}>{CARE_PLAN_ACK_ROLE_LABELS[role]}</option>)}
            </select>
          </label>
          <label className="block text-sm">Name
            <input value={signerName} onChange={(e) => setSignerName(e.target.value)} className="mt-1 block w-full rounded border p-2" />
          </label>
          {signerRole !== "resident" ? (
            <label className="block text-sm">Relationship to resident
              <input value={relationship} onChange={(e) => setRelationship(e.target.value)} className="mt-1 block w-full rounded border p-2" />
            </label>
          ) : null}
          <label className="block text-sm">How
            <select value={method} onChange={(e) => setMethod(e.target.value as CarePlanAckMethod)} className="mt-1 block w-full rounded border p-2">
              {CARE_PLAN_ACK_METHODS.map((m) => <option key={m} value={m}>{CARE_PLAN_ACK_METHOD_LABELS[m]}</option>)}
            </select>
          </label>
          {needsSignature ? (
            <div>
              <p className="mb-2 text-sm">Signature</p>
              <SignaturePad onSignatureChange={setSignature} height={150} />
            </div>
          ) : null}
          <label className="block text-sm">Notes
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 block w-full rounded border p-2" />
          </label>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <div className="flex gap-2">
            <Button disabled={!ready || busy} onClick={() => void save()}>{busy ? "Saving…" : "Save acknowledgement"}</Button>
            <Button variant="outline" onClick={() => { setOpen(false); setError(null); }}>Cancel</Button>
          </div>
        </fieldset>
      ) : null}
    </RecordDetailSection>
  );
}
