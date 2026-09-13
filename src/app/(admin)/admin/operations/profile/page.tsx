"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { fetchAdminFacilityOptions } from "@/lib/admin-facilities";
import { isOperationsViewRole } from "@/lib/operations/constants";
import type { FacilityProfileReply } from "@/lib/operations/facility-profile";
import { OperationsViewNav } from "@/components/operations/OperationsViewNav";
import { CONTROL } from "../work/_components/work-inputs";

type Entry = FacilityProfileReply["entries"][number];
type Fields = Entry["components"][number]["fields"];
const FIELD_LABELS: Record<keyof Fields, string> = {
  applicability: "Applicability",
  schedule: "Schedule",
  evidence: "Evidence",
  roles: "Recorder and reviewer roles",
  backup: "Backup",
  procedure: "Procedure",
};
const STATUS_LABELS = { unknown: "Unknown", recorded: "Recorded direction", approved: "Approved" };

export default function FacilityProfilePage() {
  const auth = useHavenAuth();
  const router = useRouter();
  const allowed = isOperationsViewRole(auth.appRole);
  useEffect(() => {
    if (!auth.loading && !allowed) router.replace("/dashboard");
  }, [auth.loading, allowed, router]);
  if (auth.loading) return <p role="status">Loading current person…</p>;
  if (!auth.user || !allowed) return <p>Facility profiles are unavailable for this person.</p>;
  return <PersonProfile key={`${auth.user.id}:${auth.appRole}:${auth.organizationId}`} actorName={auth.fullName} />;
}

function PersonProfile({ actorName }: { actorName: string | null }) {
  const router = useRouter();
  const params = useSearchParams();
  const facilityId = params.get("facility_id") ?? "";
  const [facilities, setFacilities] = useState<{ id: string; name: string }[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    void fetchAdminFacilityOptions().then(rows => {
      if (active) setFacilities(rows);
    }).catch(() => {
      if (active) setError(true);
    });
    return () => { active = false; };
  }, [attempt]);
  const accessible = facilities?.some(facility => facility.id === facilityId);
  return <div className="space-y-5 p-4 sm:p-6">
    <header className="space-y-2">
      <h1 className="text-2xl font-semibold">Facility profile</h1>
      <p className="max-w-3xl text-muted-foreground">Review checklist coverage, recorded direction and the decisions still needed for this facility.</p>
      <p>Current person: {actorName || "Signed-in person"}</p>
    </header>
    <OperationsViewNav />
    {error ? <div role="alert" className="space-y-2">
      <p>Facility options are unavailable. Access has not been confirmed.</p>
      <button className={CONTROL} onClick={() => { setError(false); setFacilities(null); setAttempt(n => n + 1); }}>Retry facilities</button>
    </div> : facilities === null ? <p role="status">Loading facilities…</p> : facilities.length === 0 ? <p>No accessible facilities.</p> : <>
      <label className="flex max-w-lg flex-col gap-1">Facility
        <select className={CONTROL} value={accessible ? facilityId : ""} onChange={event => {
          const query = new URLSearchParams();
          if (event.target.value) query.set("facility_id", event.target.value);
          router.replace(`/admin/operations/profile${query.size ? `?${query}` : ""}`, { scroll: false });
        }}>
          <option value="">Choose a facility</option>
          {facilities.map(facility => <option key={facility.id} value={facility.id}>{facility.name}</option>)}
        </select>
      </label>
      {accessible ? <ProfileScope key={facilityId} facilityId={facilityId} /> : <p>{facilityId ? "The selected facility is no longer accessible. Choose an available facility." : "Choose a facility to review its profile."}</p>}
    </>}
  </div>;
}

function ProfileScope({ facilityId }: { facilityId: string }) {
  const [body, setBody] = useState<FacilityProfileReply | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [query, setQuery] = useState("");
  const [unknownOnly, setUnknownOnly] = useState(false);
  const [prepared, setPrepared] = useState<{ prepared: number; preserved: number; unresolved: number } | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/admin/operations/facility-profile?${new URLSearchParams({ facility_id: facilityId })}`, {
      credentials: "same-origin", cache: "no-store", signal: controller.signal,
    }).then(async response => {
      if (!response.ok) throw new Error([401, 403, 404].includes(response.status)
        ? "This facility profile is no longer accessible."
        : "Facility profile unavailable. Coverage has not been confirmed.");
      const reply = await response.json() as FacilityProfileReply;
      if (!reply || reply.complete !== true || reply.facility?.id !== facilityId || !Array.isArray(reply.entries)
        || reply.entries.length !== reply.coverage?.source_count
        || reply.entries.reduce((sum, entry) => sum + entry.components.length, 0) !== reply.coverage.component_count)
        throw new Error("The complete facility profile could not be confirmed. Retry the request.");
      return reply;
    }).then(reply => {
      if (!controller.signal.aborted) setBody(reply);
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) {
        setBody(null);
        setError(reason instanceof Error ? reason.message : "Facility profile unavailable.");
      }
    });
    return () => controller.abort();
  }, [facilityId, attempt]);
  const preparationNotice = prepared ? <p role="status">Activity drafts prepared: {prepared.prepared}. Existing activities preserved: {prepared.preserved}. Unresolved mappings: {prepared.unresolved}. Drafts still need attributable approval.</p> : null;
  if (error) return <>{preparationNotice}<div role="alert" className="space-y-2"><p>{error}</p>
    <button className={CONTROL} onClick={() => { setBody(null); setError(""); setAttempt(n => n + 1); }}>Retry profile</button>
  </div></>;
  if (!body) return <>{preparationNotice}<p role="status">Loading facility profile…</p></>;
  const term = query.trim().toLowerCase();
  const entries = body.entries.filter(entry => (!unknownOnly || entry.disposition === "needs_confirmation" || entry.components.some(component =>
    Object.values(component.fields).some(field => field.status !== "approved")))
    && [entry.source_id, entry.source_text, ...entry.question_ids, ...entry.components.map(component => component.label)]
      .some(value => value.toLowerCase().includes(term)));
  return <section aria-label="Facility profile coverage" className="space-y-4">
    <div className="rounded-lg border p-4 space-y-2">
      <h2 className="text-lg font-semibold">{body.facility.name}</h2>
      <p>{body.facility.entity_name} · {body.facility.timezone || "Timezone unknown"}</p>
      <p>{body.profile.identity_status === "verified" ? "Facility identity verified" : body.profile.identity_status === "mismatch" ? "Facility identity needs re-verification" : "Facility profile not yet configured"}</p>
      {body.profile.identity_provenance.map((source, index) => <p key={index} className="text-sm break-words">Identity source: {source.source}</p>)}
      <p>Source items: {body.coverage.source_count} · Checklist components: {body.coverage.component_count}</p>
      <p>Approved rules: {body.summary.approved_rule_count} · Rules needing confirmation: {body.summary.unknown_rule_count}</p>
      {body.summary.recorded_rule_count !== undefined ? <p>Components with recorded configuration: {body.summary.recorded_rule_count}. Publication alone does not verify business approval.</p> : null}
      <p>Source mappings needing confirmation: {body.coverage.mapping_unknown_count}</p>
      <p className="text-sm text-muted-foreground">Unconfirmed timing has no due or overdue judgment. Recorded direction can be incomplete.</p>
    </div>
    {preparationNotice}
    {body.can_prepare_drafts ? <PrepareDrafts facilityId={facilityId} componentCount={body.coverage.component_count} onPrepared={result => {
      setPrepared(result); setBody(null); setAttempt(n => n + 1);
    }} /> : null}
    {body.entries.length === 0 ? <p>No source items are recorded in this facility profile.</p> : <>
      <div className="flex flex-wrap items-end gap-4">
        <label className="flex flex-col gap-1">Find a source item or question
          <input className={CONTROL} type="search" value={query} onChange={event => setQuery(event.target.value)} />
        </label>
        <label className="flex items-center gap-2 py-2"><input type="checkbox" checked={unknownOnly} onChange={event => setUnknownOnly(event.target.checked)} />Needs confirmation only</label>
      </div>
      <p role="status">Showing {entries.length} of {body.coverage.source_count} source items.</p>
      {entries.length === 0 ? <p>No source items match these filters.</p> : entries.map(entry => <SourceEntry key={entry.source_id} entry={entry} />)}
    </>}
  </section>;
}

function readable(value: unknown): string {
  if (value === null || value === undefined || value === "") return "Unknown";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) return value.length ? value.map(readable).join(", ") : "None recorded";
  if (typeof value === "object") return Object.entries(value).map(([key, item]) => `${key.replaceAll("_", " ")}: ${readable(item)}`).join("; ");
  return String(value);
}

function SourceEntry({ entry }: { entry: Entry }) {
  return <details className="rounded-lg border p-4">
    <summary className="cursor-pointer font-medium">{entry.source_id}: {entry.source_text} <span className="font-normal">({entry.components.length} {entry.components.length === 1 ? "component" : "components"})</span></summary>
    <div className="mt-4 space-y-4">
      <p className="text-sm">Source: {entry.source_sheet}, cell {entry.source_cell}. {entry.disposition === "needs_confirmation" ? "Source mapping needs confirmation." : "Source mapping recorded."}</p>
      {entry.confirmation_reason ? <p>{entry.confirmation_reason}</p> : null}
      <p className="text-sm break-all">Source fingerprint: {entry.source_sha256}</p>
      <p>Questions: {entry.question_ids.join(", ") || "None recorded"}</p>
      {entry.components.map(component => <section key={component.activity_id} aria-label={component.label} className="border-t pt-3 space-y-2">
        <h3 className="font-semibold">{component.label}</h3>
        <p className="text-sm">Component type: {component.kind.replaceAll("_", " ")} · Subject: {component.subject_kind ?? "Needs confirmation"}</p>
        <p>{component.recording.reason}</p>
        <p className="text-sm">Draft preparation: {component.drafts.status === "existing_drafts" ? "Drafts exist; approval still needs confirmation" : component.drafts.status === "published" ? "Published configuration preserved; see its source and approval details" : component.drafts.status === "needs_confirmation" ? "Source mapping needs confirmation before drafting" : "Not prepared"}</p>
        {component.publication && (component.publication.requirement || component.publication.configuration) ? <details className="rounded border p-3 text-sm">
          <summary className="cursor-pointer font-medium">Recorded source and publication details</summary>
          <p className="mt-2">These are stored attribution and approval claims, not independent verification of an operating rule.</p>
          {component.publication.requirement ? <div className="mt-3 space-y-1">
            <p>Central version: {component.publication.requirement.version ?? "Not recorded"}</p>
            <p className="break-words">Recorded publication actor: {component.publication.requirement.published_by ?? "Not recorded"}</p>
            <p>Published at: {component.publication.requirement.published_at ?? "Not recorded"}</p>
            <p>Effective window: {component.publication.requirement.effective_from ?? "Not recorded"} to {component.publication.requirement.effective_to ?? "No end recorded"}</p>
            <p>Recorded source details:</p>
            <pre className="whitespace-pre-wrap break-words font-sans">{component.publication.requirement.source_authority ? JSON.stringify(component.publication.requirement.source_authority, null, 2) : "Not recorded"}</pre>
          </div> : null}
          {component.publication.configuration ? <div className="mt-3 space-y-1">
            <p>Facility version: {component.publication.configuration.version ?? "Not recorded"} · Source: {component.publication.configuration.override_source ?? "Not recorded"}</p>
            <p className="break-words">Recorded approval actor: {component.publication.configuration.approved_by ?? "Not recorded"}</p>
            <p>Approval recorded at: {component.publication.configuration.approved_at ?? "Not recorded"}</p>
            <p>Effective window: {component.publication.configuration.effective_from ?? "Not recorded"} to {component.publication.configuration.effective_to ?? "No end recorded"}</p>
            <p>Applicability reason: {component.publication.configuration.applicability_reason ?? "Not recorded"}</p>
          </div> : null}
        </details> : null}
        <dl className="space-y-3">
          {(Object.keys(FIELD_LABELS) as (keyof Fields)[]).map(key => {
            const field = component.fields[key];
            return <div key={key}>
              <dt className="font-medium">{FIELD_LABELS[key]}: {STATUS_LABELS[field.status]}</dt>
              <dd className="space-y-1 text-sm">
                {field.value !== null && field.value !== undefined ? <p>{readable(field.value)}</p> : null}
                {field.reason ? <p>{field.reason}</p> : null}
                {field.provenance.map((source, index) => <p key={index} className="break-words text-muted-foreground">
                  Source: {source.source} · Recorded answer: {source.answer_id || "Not recorded"} · Recorded approver: {source.approver_id || "Not recorded"} · Effective from: {source.effective_from || "Not recorded"}
                </p>)}
              </dd>
            </div>;
          })}
        </dl>
      </section>)}
    </div>
  </details>;
}


type PreparationResult = { prepared: number; preserved: number; unresolved: number };
function PrepareDrafts({ facilityId, componentCount, onPrepared }: { facilityId: string; componentCount: number; onPrepared: (result: PreparationResult) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  async function prepare() {
    if (request.current) return;
    const controller = new AbortController(); request.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/admin/operations/facility-profile/drafts", {
        method: "POST", credentials: "same-origin", cache: "no-store", signal: controller.signal,
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ facility_id: facilityId }),
      });
      if (!response.ok) throw new Error([401, 403, 404].includes(response.status)
        ? "Draft preparation is no longer authorized for this facility."
        : "Draft preparation could not be confirmed. Retry preserves existing drafts and published versions.");
      const result = await response.json() as PreparationResult & { results: unknown[] };
      if (!result || ![result.prepared, result.preserved, result.unresolved].every(value => Number.isSafeInteger(value) && value >= 0)
        || result.prepared + result.preserved + result.unresolved !== componentCount
        || !Array.isArray(result.results) || result.results.length !== componentCount)
        throw new Error("Draft preparation could not be confirmed. Retry preserves existing drafts and published versions.");
      if (!controller.signal.aborted) onPrepared(result);
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Draft preparation could not be confirmed.");
    } finally {
      if (!controller.signal.aborted) { request.current = null; setBusy(false); }
    }
  }
  return <div className="rounded-lg border p-4 space-y-2">
    <h2 className="font-semibold">Prepare drafts for review</h2>
    <p className="text-sm">Create missing activity and facility drafts from the source catalog. Existing drafts and published versions are preserved. Unresolved mappings remain visible, and drafts need approval before activation.</p>
    <button type="button" className={CONTROL} disabled={busy} onClick={() => void prepare()}>{busy ? "Preparing drafts…" : "Prepare missing drafts"}</button>
    {busy ? <p role="status">Waiting for the server to confirm draft preparation…</p> : null}
    {error ? <p role="alert">{error}</p> : null}
  </div>;
}
