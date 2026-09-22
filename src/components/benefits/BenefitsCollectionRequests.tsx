"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { facilityDatetimeLocalToUtcIso } from "@/lib/facility-wall-clock";
import { FormLabel } from "@/components/ui/form-label";
import type { BenefitsDetail } from "@/lib/benefits/contracts";
import type { BenefitsCollectionList } from "@/lib/benefits/family-server";
import { benefitsFetch, ErrorNotice, Panel, dateLabel } from "./benefits-ui";

export function BenefitsCollectionRequests({ detail, onChanged }: { detail: BenefitsDetail; onChanged: () => void | Promise<void> }) {
  const [data, setData] = useState<BenefitsCollectionList | null>(null);
  const [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const [requirementId, setRequirementId] = useState(""), [familyId, setFamilyId] = useState("");
  const [expires, setExpires] = useState("");
  const attempt = useRef<{ signature: string; requestId: string } | null>(null);
  const base = `/api/admin/benefits/cases/${detail.case.id}/collection`;
  const load = useCallback(async () => { try { setData(await benefitsFetch<BenefitsCollectionList>(base)); setError(null); } catch (e) { setData(null); setError(e instanceof Error ? e.message : "Could not load collection requests."); } }, [base]);
  useEffect(() => { void load(); }, [load, detail.case.revision]);
  const requirement = detail.requirements.find((item) => item.id === requirementId);
  const canChange = detail.permissions.can_write && detail.case.status !== "closed";
  const send = async (action: "assign" | "revoke", payload: Record<string, string>) => {
    if (busy || !canChange) return;
    setBusy(true); setError(null);
    const command = { action, payload, expected_revision: detail.case.revision };
    const signature = JSON.stringify(command);
    if (attempt.current?.signature !== signature) attempt.current = { signature, requestId: crypto.randomUUID() };
    try {
      await benefitsFetch(base, { method: "POST", body: JSON.stringify({ ...command, request_id: attempt.current.requestId }) });
      attempt.current = null; await onChanged(); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save request."); } finally { setBusy(false); }
  };
  const selectClass = "min-h-11 w-full rounded-md border border-input bg-background px-3 text-sm";
  return <Panel title="Family document collection" description="Assign a specific requested item to an authorized linked family member. It appears in their signed-in family portal. Uploads require staff review; no message is sent.">
    {error && <ErrorNotice error={error} />}
    {!data && !error && <p role="status">Loading document requests…</p>}
    {error && <Button type="button" variant="outline" className="min-h-11" onClick={() => void load()}>Refresh requests</Button>}
    {data && <>
      {canChange && <form className="grid gap-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); if (!requirementId || !familyId || !expires) return; void send("assign", { requirement_id: requirementId, family_user_id: familyId, expires_at: facilityDatetimeLocalToUtcIso(expires)! }); }}>
        <div><FormLabel htmlFor="collection-requirement">Requested item</FormLabel><select id="collection-requirement" className={selectClass} required value={requirementId} onChange={(event) => { setRequirementId(event.target.value); setFamilyId(""); }}><option value="">Choose an item</option>{detail.requirements.filter((item) => !["accepted", "not_applicable"].includes(item.status)).map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select></div>
        <div><FormLabel htmlFor="collection-family">Family member</FormLabel><select id="collection-family" className={selectClass} required value={familyId} onChange={(event) => setFamilyId(event.target.value)}><option value="">Choose an authorized person</option>{data.eligible_family.filter((item) => !requirement || requirement.signature_status === "not_required" || item.can_make_decisions).map((item) => <option key={item.id} value={item.id}>{item.name || "Linked family member"}</option>)}</select></div>
        <div><FormLabel htmlFor="collection-expiry">Access expires (Eastern; the organization’s family upload window applies)</FormLabel><Input id="collection-expiry" type="datetime-local" required className="min-h-11" value={expires} onChange={(event) => setExpires(event.target.value)} /></div>
        <div className="flex items-end"><Button type="submit" disabled={busy || !requirementId || !familyId} className="min-h-11">{busy ? "Saving…" : "Assign document request"}</Button></div>
      </form>}
      {canChange && data.eligible_family.length === 0 && <p className="text-sm text-muted-foreground">No family member has current financial access. An authorized administrator must establish the resident linkage and permissions first.</p>}
      {data.requests.length === 0 ? <p className="text-sm text-muted-foreground">No family document requests assigned.</p> : <ul className="divide-y">{data.requests.map((item) => <li className="flex flex-wrap items-center justify-between gap-3 py-3" key={item.id}><div><p className="font-medium">{detail.requirements.find((r) => r.id === item.requirement_id)?.title || "Requested document"}</p><p className="text-sm text-muted-foreground">{item.family_name || "Family member"} · {item.revoked_at ? "Revoked" : item.received_at ? "Received for review" : new Date(item.expires_at) <= new Date() ? "Expired" : "Awaiting upload"} · Expires {dateLabel(item.expires_at)}</p></div>{canChange && !item.revoked_at && <Button type="button" variant="outline" disabled={busy} className="min-h-11" onClick={() => void send("revoke", { collection_id: item.id })}>Revoke access</Button>}</li>)}</ul>}
    </>}
  </Panel>;
}
