"use client";
import { useState } from "react";
import { useEmployeeResource } from "@/lib/staff/use-employee-resource";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type ReviewerData = { profiles: { id: string; full_name: string | null; app_role: string }[]; grants: { id: string; user_id: string; granted_at: string }[] };
export function EmployeeMedicalReviewers({ staffId, onChange }: { staffId: string; onChange: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const endpoint = `/api/admin/staff/${staffId}/employee-file/requirements`;
  const { data, error: loadError } = useEmployeeResource<ReviewerData>(endpoint, revision);
  return <section className="space-y-4 rounded-lg border bg-card p-5"><h2 className="text-lg font-semibold">Confidential medical-file reviewers</h2><p className="text-sm text-muted-foreground">Designate reviewers independently of their general management access. They must also have access to this facility.</p>{(error || loadError) && <p role="alert">{error || loadError}</p>}{data && <><ul>{data.grants.map((g) => <li key={g.id}>{data.profiles.find((p) => p.id === g.user_id)?.full_name || "Reviewer"} · Access granted</li>)}</ul><form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); const f = new FormData(e.currentTarget); setBusy(true); setError(null); void (async () => { try { const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: f.get("action"), payload: { user_id: f.get("reviewer"), review_note: f.get("reason") } }) }); const b = await r.json(); if (!r.ok) throw new Error(b.error); setRevision((v) => v + 1); await onChange(); } catch (e) { setError(e instanceof Error ? e.message : "Could not update access."); } finally { setBusy(false); } })(); }}><label className="grid gap-1 text-sm">Reviewer<select name="reviewer" className="rounded border bg-background p-2" required><option value="">Select a reviewer</option>{data.profiles.map((p) => <option key={p.id} value={p.id}>{p.full_name || "Unnamed account"} · {p.app_role.replaceAll("_", " ")}</option>)}</select></label><label className="grid gap-1 text-sm">Reason<Input name="reason" required /></label><label className="grid gap-1 text-sm">Access change<select name="action" className="rounded border bg-background p-2"><option value="grant_medical">Grant</option><option value="revoke_medical">Revoke</option></select></label><Button type="submit" disabled={busy}>Save access change</Button></form></>}</section>;
}
