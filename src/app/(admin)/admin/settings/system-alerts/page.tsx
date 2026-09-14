"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Mail } from "lucide-react";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const ENDPOINT = "/api/admin/settings/system-alerts";
const ALERT_KINDS = [
  { value: "job_failure", label: "Scheduled job failures" },
  { value: "job_recovery", label: "Scheduled job recovery" },
  { value: "monitor_failure", label: "Monitoring interruptions" },
];
type Settings = { version: number; enabled: boolean; recipients: string[]; alertKinds: string[] };
type Overview = {
  settings: Settings;
  emailConfigured: boolean;
  monitoringConfigured: boolean;
  audit: { actor_id: string; actor_name: string | null; changed_at: string; before_settings: Settings | null; after_settings: Settings }[];
  deliveries: { id: string; kind: string; status: string; created_at: string; updated_at: string; error_code: string | null }[];
  jobs: { jobid: number; jobname: string; state: string; checked_at: string }[];
};
const deliveryLabels: Record<string, string> = {
  provider_accepted: "Accepted for sending — delivery not confirmed",
  failed: "Sending failed", unconfigured: "Email setup incomplete",
  pending: "Awaiting sending", sending: "Sending", indeterminate: "Outcome not confirmed",
  cancelled: "Cancelled", unknown: "Outcome not confirmed",
};
const jobLabels: Record<string, string> = {
  removed: "Removed", disabled: "Paused", not_monitored: "Not monitored",
  unsupported_schedule: "Schedule needs review", did_not_run: "Missed run",
  awaiting_first_run: "Awaiting first run", pending: "Awaiting result", success: "Last run succeeded",
  refused: "Run declined", error: "Failed", response_missing: "Result missing",
};
function timestamp(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Time unavailable" : date.toLocaleString();
}

export default function SystemAlertsPage() {
  const { appRole, loading, organizationId } = useHavenAuth();
  if (loading) return <p className="p-6" role="status">Loading settings…</p>;
  if (!["owner", "org_admin"].includes(appRole)) {
    return <div className="p-6"><h1 className="text-2xl font-semibold">System alerts</h1><p className="mt-2">Only owners and organization admins can manage system alerts.</p></div>;
  }
  if (!organizationId) return <p className="p-6" role="status">Waiting for your organization…</p>;
  return <SystemAlertsForm key={organizationId} />;
}

function SystemAlertsForm() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [primary, setPrimary] = useState("");
  const [backups, setBackups] = useState("");
  const [kinds, setKinds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"save" | "test" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [conflict, setConflict] = useState(false);

  const adoptSettings = useCallback((settings: Settings) => {
    setEnabled(settings.enabled);
    setPrimary(settings.recipients[0] ?? "");
    setBackups(settings.recipients.slice(1).join("\n"));
    setKinds(settings.alertKinds);
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const response = await fetch(ENDPOINT, { cache: "no-store", signal });
      if (!response.ok) throw new Error("Could not load system alerts. Try again.");
      const data: Overview = await response.json();
      if (signal?.aborted) return;
      setOverview(data);
      adoptSettings(data.settings);
      setConflict(false);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : "Could not load system alerts.");
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [adoptSettings]);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const recipients = [primary.trim(), ...backups.split(/[\n,;]/).map((value) => value.trim())].filter(Boolean);
  const dirty = !!overview && (enabled !== overview.settings.enabled ||
    JSON.stringify(recipients) !== JSON.stringify(overview.settings.recipients) ||
    JSON.stringify([...kinds].sort()) !== JSON.stringify([...overview.settings.alertKinds].sort()));

  async function mutate(action: "save" | "test") {
    if (!overview || busy) return;
    setError(null);
    setMessage(null);
    if (action === "save" && recipients.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))) {
      setError("Enter a valid email address for each recipient."); return;
    }
    if (action === "save" && recipients.length > 0 && !primary.trim()) {
      setError("Enter a primary email before adding backup recipients."); return;
    }
    if (action === "save" && kinds.length === 0) {
      setError("Choose at least one alert type. You can pause alerts with the enable checkbox."); return;
    }
    if (action === "save" && enabled && !primary.trim()) {
      setError("Choose a primary email before enabling alerts."); return;
    }
    if (action === "save" && (recipients.length > 10 || recipients.some((email) => email.length > 254))) {
      setError("Use up to 10 recipients, with each email no longer than 254 characters."); return;
    }
    if (action === "save" && new Set(recipients.map((email) => email.toLowerCase())).size !== recipients.length) {
      setError("Each recipient email must be unique."); return;
    }
    setBusy(action);
    try {
      const response = await fetch(action === "save" ? ENDPOINT : `${ENDPOINT}/test`, {
        method: action === "save" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "save"
          ? { expectedVersion: overview.settings.version, enabled, recipients, alertKinds: kinds }
          : { expectedVersion: overview.settings.version }),
      });
      if (response.status === 409) {
        setConflict(true);
        setError("Settings changed since you opened this page. Reload the latest settings before continuing.");
        return;
      }
      if (!response.ok) {
        if (action === "test") await load();
        throw new Error(response.status === 429 ? "Please wait a minute before sending another test."
          : action === "test" ? "The test email could not be sent. Check recent email outcomes and try again."
            : "Settings could not be saved. Your edits are still here; try again.");
      }
      if (action === "save") {
        const data: { settings: Settings } = await response.json();
        setOverview({ ...overview, settings: data.settings });
        adoptSettings(data.settings);
        await load();
        setMessage("System alert settings saved.");
      } else {
        const result: { status: string } = await response.json();
        await load();
        if (result.status !== "provider_accepted") throw new Error("The test email was not confirmed as accepted. Check recent email outcomes before trying again.");
        setMessage("Test email accepted for sending. Check the saved recipients’ inboxes to confirm delivery.");
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The request could not be completed.");
    } finally {
      setBusy(null);
    }
  }

  return <div className="mx-auto max-w-5xl space-y-6 p-4 md:p-6">
    <header>
      <Link href="/admin/settings" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft className="mr-2 size-4" aria-hidden />Settings</Link>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">System alerts</h1>
      <p className="mt-1 text-sm text-muted-foreground">Email updates when scheduled work fails, recovers, or monitoring needs attention.</p>
    </header>
    {error && <div role="alert" className="rounded-lg border border-destructive p-4 text-sm">{error}</div>}
    {message && <p role="status" className="rounded-lg border p-4 text-sm">{message}</p>}
    {loading && <p role="status">Loading system alerts…</p>}
    {(conflict || (!loading && !overview)) && <Button variant="outline" disabled={loading || !!busy} onClick={() => { setError(null); setMessage(null); void load(); }}>{conflict ? "Discard edits and reload latest settings" : "Retry loading"}</Button>}
    {overview && <>
      {!overview.emailConfigured && <p role="status" className="rounded-lg border p-4 text-sm">Email sending is not set up yet. You can save recipients now; contact your system administrator to activate email sending.</p>}
      {!overview.monitoringConfigured && <p role="status" className="rounded-lg border p-4 text-sm">Scheduled job monitoring is not activated for this organization yet. Contact your system administrator to complete activation.</p>}
      <div className="flex flex-wrap items-center gap-3"><Button variant="outline" disabled={!!busy || loading || dirty || conflict} onClick={() => { setError(null); setMessage(null); void load(); }}>Refresh results</Button><p className="text-sm text-muted-foreground">Refresh to see the latest recorded outcomes.</p></div>
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><Mail className="size-5" aria-hidden />Email recipients</CardTitle><CardDescription>Changes apply to this organization. Primary and backup recipients receive the same selected alerts at the same time.</CardDescription></CardHeader>
        <CardContent>
          <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); void mutate("save"); }}>
            <fieldset disabled={!!busy || loading || conflict} className="space-y-5 disabled:opacity-60">
              <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} className="size-4 accent-primary" />Enable email alerts</label>
              <div className="space-y-2"><label htmlFor="primary-email" className="text-sm font-medium">Primary email</label><Input id="primary-email" type="email" maxLength={254} autoComplete="email" value={primary} onChange={(event) => setPrimary(event.target.value)} /></div>
              <div className="space-y-2"><label htmlFor="backup-emails" className="text-sm font-medium">Backup emails (optional)</label><Textarea id="backup-emails" aria-describedby="backup-help" rows={3} value={backups} onChange={(event) => setBackups(event.target.value)} /><p id="backup-help" className="text-sm text-muted-foreground">Enter one email per line, or separate them with commas. Up to 9 backups.</p></div>
              <fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Alert types</legend>{ALERT_KINDS.map((kind) => <label key={kind.value} className="flex min-h-11 items-center gap-3 text-sm"><input type="checkbox" className="size-4 accent-primary" checked={kinds.includes(kind.value)} onChange={(event) => setKinds(event.target.checked ? [...kinds, kind.value] : kinds.filter((value) => value !== kind.value))} />{kind.label}</label>)}</fieldset>
              <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={!dirty}>{busy === "save" ? "Saving…" : "Save settings"}</Button><span className="text-sm text-muted-foreground">{dirty ? "You have unsaved changes." : enabled ? "Email alerts are enabled." : "Email alerts are paused."}</span></div>
            </fieldset>
          </form>
        </CardContent>
      </Card>
      <Card><CardHeader><CardTitle>Test email</CardTitle><CardDescription>Sends one test email to all saved recipients. Save your changes first.</CardDescription></CardHeader><CardContent className="space-y-3"><Button variant="outline" disabled={!!busy || loading || dirty || conflict || !overview.emailConfigured || overview.settings.recipients.length === 0} onClick={() => void mutate("test")}>{busy === "test" ? "Sending test…" : "Send test email to saved recipients"}</Button>{overview.settings.recipients.length === 0 && <p className="text-sm text-muted-foreground">Save at least one recipient before testing.</p>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Recent email outcomes</CardTitle><CardDescription>Accepted for sending does not confirm inbox delivery.</CardDescription></CardHeader><CardContent>{overview.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">No email attempts recorded yet.</p> : <ul className="divide-y">{overview.deliveries.map((delivery) => <li key={delivery.id} className="space-y-1 py-3 text-sm"><p className="font-medium">{ALERT_KINDS.find((kind) => kind.value === delivery.kind)?.label ?? (delivery.kind === "test" ? "Test email" : "System alert")}</p><p>{deliveryLabels[delivery.status] ?? "Outcome not confirmed"}</p><p className="text-muted-foreground">{timestamp(delivery.created_at)}</p></li>)}</ul>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Scheduled job results</CardTitle><CardDescription>Latest recorded monitoring results.</CardDescription></CardHeader><CardContent>{overview.jobs.length === 0 ? <p className="text-sm text-muted-foreground">No monitoring results recorded yet.</p> : <ul className="divide-y">{overview.jobs.map((job) => <li key={job.jobid} className="flex flex-wrap justify-between gap-2 py-3 text-sm"><div><p className="font-medium">{job.jobname}</p><p className="text-muted-foreground">{timestamp(job.checked_at)}</p></div><p>{jobLabels[job.state] ?? "Needs review"}</p></li>)}</ul>}</CardContent></Card>
      <Card><CardHeader><CardTitle>Settings change history</CardTitle><CardDescription>Recent changes for this organization.</CardDescription></CardHeader><CardContent>{overview.audit.length === 0 ? <p className="text-sm text-muted-foreground">No settings changes recorded yet.</p> : <ul className="divide-y">{overview.audit.map((entry) => <li key={`${entry.changed_at}-${entry.after_settings.version}`} className="space-y-1 py-3 text-sm"><p className="font-medium">{entry.before_settings ? "Settings updated" : "Settings created"} · {timestamp(entry.changed_at)}</p><p>Changed by {entry.actor_name ?? "Administrator"}</p><p>{entry.after_settings.enabled ? "Alerts enabled" : "Alerts paused"} · Recipients: {entry.after_settings.recipients.join(", ") || "None"}</p><p>Alert types: {entry.after_settings.alertKinds.map((kind) => ALERT_KINDS.find((item) => item.value === kind)?.label ?? "System alert").join(", ")}</p></li>)}</ul>}</CardContent></Card>
    </>}
  </div>;
}
