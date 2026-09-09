"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FinanceHubNav } from "@/app/(admin)/finance/finance-hub-nav";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { formatReviewCents, formatReviewTimestamp, loadReviewChoices, loadReviewDetail, loadReviewPage, type ReviewChoices, type ReviewCursor, type ReviewDetail, type ReviewKind, type ReviewPage, type ReviewScope, type SourceControl } from "@/lib/finance-integration/review-queue";
import type { Database } from "@/types/database";
type Client = SupabaseClient<Database>;
const PAGE_SIZE = 25;
const selectClass = "h-10 w-full min-w-0 max-w-full rounded-md border border-input bg-background px-3 text-sm";
const kindLabels = { events: "Source events", batches: "Local batches", rules: "Declared rules" };
const statusLabels = { prepared: "Prepared for local review", locally_approved_dispatch_disabled: "Local review recorded · external posting disabled", invalidated: "Invalidated", rejected: "Rejected", superseded: "Superseded" };
const operationLabels = { payment_received: "Payment received", invoice_posted: "Invoice posted", manual_journal_posted: "Manual journal posted", journal_reversed: "Journal reversed" };
const basisLabels = { payment_gross: "Gross payment", invoice_gross: "Gross invoice", journal_debit_total: "Journal debit total" };
// A response belongs to one exact load identity. Changing any dependency hides
// prior data during render, before effect cleanup, even if transport ignores abort.
function useRead<T>(load: (signal: AbortSignal) => Promise<T>, refresh: number): { data?: T; error?: string } {
    const [result, setResult] = useState<{
        load: typeof load;
        refresh: number;
        data?: T;
        error?: string;
    }>();
    useEffect(() => {
        const controller = new AbortController();
        let active = true;
        void load(controller.signal).then(data => { if (active)
            setResult({ load, refresh, data }); }, () => {
            if (active)
                setResult({ load, refresh, error: "This view is unavailable. Your access may have changed, or the request failed. Retry to check the current state." });
        });
        return () => { active = false; controller.abort(); };
    }, [load, refresh]);
    return result?.load === load && result.refresh === refresh ? result : {};
}
export default function FinanceReviewQueueClient() {
    const client = useMemo(() => createClient(), []);
    const auth = useHavenAuth();
    const selectedFacilityId = useFacilityStore(state => state.selectedFacilityId);
    const [refresh, setRefresh] = useState(0);
    const organizationId = auth.organizationId;
    const session = auth.session;
    const load = useCallback((signal: AbortSignal) => {
        if (!organizationId || !auth.user || !session || auth.loading || !["owner", "org_admin", "facility_admin"].includes(auth.appRole))
            return Promise.resolve<ReviewChoices>({ entities: [], facilities: [] });
        return loadReviewChoices(client, organizationId, signal);
    }, [client, organizationId, auth.user, session, auth.loading, auth.appRole]);
    const choices = useRead(load, refresh);
    const ready = !auth.loading && auth.user && organizationId && session;
    return <div className="space-y-6">
    <FinanceHubNav />
    <div><h1 className="text-2xl font-semibold">Accounting review</h1><p className="text-sm text-muted-foreground">Inspect source events, proposed batches and declared rules in your current scope.</p></div>
    <Card className="border-amber-300"><CardHeader><CardTitle className="text-base">External posting and business release are disabled</CardTitle><CardDescription>Accounting classification is unverified. A local review does not establish correct accounting treatment, privacy approval or a verified provider connection. This viewer cannot prepare, approve or release batches.</CardDescription></CardHeader></Card>
    {!ready ? <p role="status">{auth.loading ? "Checking current access…" : "Sign in with current finance access to view accounting review."}</p> : choices.error ? <ReadError message={choices.error} retry={() => setRefresh(value => value + 1)}/> : !choices.data ? <p role="status">Loading authorized scopes…</p> : <ScopeBrowser key={`${auth.user?.id}:${organizationId}:${auth.appRole}:${selectedFacilityId ?? "all"}`} client={client} choices={choices.data} organizationId={organizationId} preferredFacility={selectedFacilityId} broadScope={auth.appRole === "owner" || auth.appRole === "org_admin"}/>}
  </div>;
}
function ScopeBrowser({ client, choices, organizationId, preferredFacility, broadScope }: {
    client: Client;
    choices: ReviewChoices;
    organizationId: string;
    preferredFacility: string | null;
    broadScope: boolean;
}) {
    const preferred = choices.facilities.find(row => row.id === preferredFacility);
    const firstEntity = preferred?.entity_id ?? choices.entities[0]?.id ?? "";
    const [selection, setSelection] = useState({ entityId: firstEntity, facilityId: preferred?.id ?? (broadScope ? null : choices.facilities.find(row => row.entity_id === firstEntity)?.id ?? null) });
    const facilities = choices.facilities.filter(row => row.entity_id === selection.entityId);
    const [kind, setKind] = useState<ReviewKind>("events");
    const available = selection.entityId && (broadScope || selection.facilityId !== null);
    return <>
    <Card><CardHeader><CardTitle className="text-lg">Review scope</CardTitle><CardDescription>Selectors use currently authorized records. Each page is a live observation; previous and next pages can change between requests.</CardDescription></CardHeader><CardContent className="flex flex-wrap gap-4">
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Entity<select className={selectClass} value={selection.entityId} onChange={event => { const entityId = event.target.value; setSelection({ entityId, facilityId: broadScope ? null : choices.facilities.find(row => row.entity_id === entityId)?.id ?? null }); }}><option value="" disabled>Select entity</option>{choices.entities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
      <label className="flex min-w-0 max-w-full flex-col gap-1 text-sm">Facility<select className={selectClass} value={selection.facilityId ?? ""} onChange={event => setSelection({ ...selection, facilityId: event.target.value || null })}>{broadScope ? <option value="">All authorized facilities in entity</option> : <option value="" disabled>Select facility</option>}{facilities.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
    </CardContent></Card>
    <Tabs value={kind} onValueChange={value => { if (value === "events" || value === "batches" || value === "rules") setKind(value); }}>
      <TabsList aria-label="Accounting review records">{(["events", "batches", "rules"] as const).map(value => <TabsTrigger key={value} value={value} className="text-foreground dark:text-foreground">{kindLabels[value]}</TabsTrigger>)}</TabsList>
      {(["events", "batches", "rules"] as const).map(value => <TabsContent key={value} value={value}>{kind === value ? available ? <QueuePanel key={`${selection.entityId}:${selection.facilityId}:${kind}`} client={client} scope={{ organizationId, ...selection }} kind={kind}/> : <p role="status">No authorized entity and facility scope is available. Refresh your access or choose another scope.</p> : null}</TabsContent>)}
    </Tabs>
  </>;
}
function ReadError({ message, retry }: {
    message: string;
    retry: () => void;
}) { return <div role="alert" className="space-y-2 rounded-lg border border-destructive p-4"><p>{message}</p><Button variant="outline" onClick={retry}>Retry</Button></div>; }
function Controls({ rows }: {
    rows: SourceControl[];
}) { return <ul className="space-y-1">{rows.map(row => <li key={`${row.amountBasis}:${row.operation}`}>{operationLabels[row.operation]} · {basisLabels[row.amountBasis]}: <strong>{formatReviewCents(row.grossCents)}</strong> ({row.eventCount} events)</li>)}</ul>; }
function QueuePanel({ client, scope, kind }: {
    client: Client;
    scope: ReviewScope;
    kind: ReviewKind;
}) {
    const [cursors, setCursors] = useState<(ReviewCursor | null)[]>([null]);
    const [refresh, setRefresh] = useState(0);
    const [batchId, setBatchId] = useState<string | null>(null);
    const cursor = cursors[cursors.length - 1];
    const { organizationId, entityId, facilityId } = scope;
    const load = useCallback((signal: AbortSignal) => loadReviewPage(client, { organizationId, entityId, facilityId, kind, cursor, limit: PAGE_SIZE }, signal), [client, organizationId, entityId, facilityId, kind, cursor]);
    const result = useRead(load, refresh);
    const page = result.data;
    function retry() { setBatchId(null); setRefresh(value => value + 1); }
    return <section aria-label={kindLabels[kind]} className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-semibold">{kindLabels[kind]}</h2>
            <Button variant="outline" onClick={retry}>Refresh page</Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {result.error ? <ReadError message={result.error} retry={retry}/> : !page ? <p role="status">Loading current page…</p> : <>
            <p className="text-sm text-muted-foreground">Observed {formatReviewTimestamp(page.observed_at)}. {page.returned_count} rows on this page; {page.total_count} matching records at this observation. Pages are not an immutable export or a complete import.</p>
            <p className="text-sm">Coverage includes only eligible payment, invoice, manual journal and reversal receipts from the current receipt system. {page.unrepresented_eligible_receipts} eligible receipts lack source events. Earlier history and other sources are outside this count.</p>
            <p className="text-sm">Preparation is {page.staging_stopped ? "paused" : "available"}. External posting and business release remain disabled.</p>
            {page.items.length === 0 ? <p role="status">No {kindLabels[kind].toLowerCase()} in this scope at this observation.</p> : <QueueRows page={page} selectBatch={setBatchId}/>}
          </>}
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="outline" disabled={cursors.length === 1} onClick={() => { setBatchId(null); setCursors(value => value.slice(0, -1)); }}>Previous page</Button>
            <span>Page {cursors.length}</span>
            <Button variant="outline" disabled={!page?.next_cursor} onClick={() => { if (page?.next_cursor) { setBatchId(null); setCursors(value => [...value, page.next_cursor]); } }}>Next page</Button>
          </div>
        </CardContent>
      </Card>
      {batchId && page ? <BatchDetail key={batchId} client={client} scope={scope} batchId={batchId} close={() => setBatchId(null)}/> : null}
    </section>;
}
function QueueRows({ page, selectBatch }: {
    page: ReviewPage;
    selectBatch: (id: string) => void;
}) {
    if (page.kind === "events")
        return <Table><TableHeader><TableRow><TableHead>Source event</TableHead><TableHead>Gross control</TableHead><TableHead>Batch claim</TableHead></TableRow></TableHeader><TableBody>{page.items.map(row => <TableRow key={row.id}><TableCell><p>{operationLabels[row.operation]}</p><p className="break-all font-mono text-xs">{row.id}</p><p className="text-xs text-muted-foreground">{formatReviewTimestamp(row.created_at)}</p></TableCell><TableCell>{formatReviewCents(row.control_total_cents)}<p className="text-xs">{basisLabels[row.amount_basis]} · not a net balance</p></TableCell><TableCell>{!row.claimed ? "Unclaimed" : row.claimed_batch_id ? <Button variant="outline" onClick={() => selectBatch(row.claimed_batch_id!)}>View claimed batch</Button> : "Claimed · batch details outside your scope"}</TableCell></TableRow>)}</TableBody></Table>;
    if (page.kind === "batches")
        return <Table><TableHeader><TableRow><TableHead>Local batch</TableHead><TableHead>Current review state</TableHead><TableHead>Source gross controls</TableHead><TableHead>Detail</TableHead></TableRow></TableHeader><TableBody>{page.items.map(row => <TableRow key={row.id}><TableCell>{row.accounting_date}<p className="break-all font-mono text-xs">{row.id}</p></TableCell><TableCell>{statusLabels[row.status]}<p>Accounting unverified</p>{row.invalid_reason ? <p>{row.invalid_reason.replaceAll("_", " ")}</p> : null}</TableCell><TableCell><Controls rows={row.source_controls}/></TableCell><TableCell><Button variant="outline" onClick={() => selectBatch(row.id)}>View batch</Button></TableCell></TableRow>)}</TableBody></Table>;
    return <Table><TableHeader><TableRow><TableHead>Declared rule version</TableHead><TableHead>Declared references</TableHead><TableHead>Proposed basis and dates</TableHead></TableRow></TableHeader><TableBody>{page.items.map(row => <TableRow key={row.id}><TableCell>{row.is_current ? "Current declared draft" : "Historical declared draft"}<p className="break-all font-mono text-xs">{row.id}</p><p>Current generation: {row.current_generation ?? "None"}</p></TableCell><TableCell>Company reference {row.mapping.companyReference}<p>Account references: {row.mapping.accountReferences.join(", ")}</p><p className="text-xs text-muted-foreground">Provider identity and accounts are unverified.</p></TableCell><TableCell>{row.mapping.accountingBasis}<p>{row.mapping.effectiveFrom} through {row.mapping.effectiveTo}</p></TableCell></TableRow>)}</TableBody></Table>;
}
function BatchDetail({ client, scope, batchId, close }: {
    client: Client;
    scope: ReviewScope;
    batchId: string;
    close: () => void;
}) {
    const [refresh, setRefresh] = useState(0);
    const { organizationId, entityId, facilityId } = scope;
    const load = useCallback((signal: AbortSignal) => loadReviewDetail(client, { organizationId, entityId, facilityId }, batchId, signal), [client, organizationId, entityId, facilityId, batchId]);
    const result = useRead(load, refresh);
    return <Card role="region" aria-label="Local batch detail"><CardHeader><div className="flex justify-between gap-3"><CardTitle>Local batch detail</CardTitle><Button variant="outline" onClick={close}>Close detail</Button></div><CardDescription>This separately authorized read may be denied if your access or the batch scope has changed.</CardDescription></CardHeader><CardContent>{result.error ? <ReadError message="Batch detail unavailable. Access may have changed; no prior detail is displayed." retry={() => setRefresh(value => value + 1)}/> : !result.data ? <p role="status">Loading authorized batch detail…</p> : <DetailContent detail={result.data}/>}</CardContent></Card>;
}
function DetailContent({ detail }: {
    detail: ReviewDetail;
}) {
    const { batch } = detail;
    return <div className="space-y-5"><p>{statusLabels[batch.status]}. Accounting unverified; business release and external posting disabled.</p>{detail.invalid_reason ? <p>Current blocker: {detail.invalid_reason.replaceAll("_", " ")}</p> : null}
    <div><h3 className="font-semibold">Exact proposed journal</h3><p>{batch.accounting_date} · USD · declared company reference {batch.payload.companyReference}</p><Table><TableHeader><TableRow><TableHead>Account reference</TableHead><TableHead>Side</TableHead><TableHead>Amount</TableHead></TableRow></TableHeader><TableBody>{batch.payload.lines.map((row, index) => <TableRow key={index}><TableCell>{row.accountReference}</TableCell><TableCell>{row.side}</TableCell><TableCell>{formatReviewCents(row.amountCents)}</TableCell></TableRow>)}</TableBody></Table><p className="text-sm text-muted-foreground">Balanced contributions do not establish correct accounting classification.</p></div>
    <div><h3 className="font-semibold">Member gross controls</h3><Controls rows={batch.source_controls}/><p className="text-sm">Original and reversal gross controls are separate; they are not summed as net financial position.</p>{detail.members.map(member => <details key={member.eventId} className="my-2 rounded border p-3"><summary>{operationLabels[member.operation]} · {formatReviewCents(member.controlTotalCents)} · {member.economicDate}</summary><p className="break-all font-mono text-xs">Event {member.eventId}</p><ul>{member.lines.map((row, index) => <li key={index}>Account reference {row.accountReference} · {row.side} · {formatReviewCents(row.amountCents)}</li>)}</ul></details>)}</div>
    <div><h3 className="font-semibold">Historical decisions</h3><p className="text-sm text-muted-foreground">Historical review evidence does not establish current actor authority or official accounting approval.</p><ol>{detail.decision_history.map(row => <li key={row.id} className="border-b py-2">{formatReviewTimestamp(row.created_at)} · {row.action === "approve" ? "Local review recorded" : row.action} · {row.origin} · {statusLabels[row.resulting_status]}{row.reason_code ? ` · ${row.reason_code.replaceAll("_", " ")}` : ""}</li>)}</ol></div>
    <details className="rounded border p-3"><summary>Artifact identity and exact proposed payload</summary><dl className="space-y-2 break-all text-xs"><dt>Batch</dt><dd>{batch.id}</dd><dt>Binding SHA-256</dt><dd>{batch.binding_sha256}</dd><dt>Payload SHA-256</dt><dd>{batch.payload_sha256}</dd><dt>Member set SHA-256</dt><dd>{batch.member_set_sha256}</dd><dt>Source controls SHA-256</dt><dd>{batch.source_controls_sha256}</dd><dt>Declared rule version</dt><dd>{batch.rules_version_id}</dd></dl><pre className="mt-3 overflow-x-auto text-xs">{JSON.stringify(batch.payload, null, 2)}</pre></details>
  </div>;
}
