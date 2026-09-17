"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, PackageCheck, PhoneIncoming, Plus, Users } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { VisitorLogClient } from "@/components/registers/VisitorLogClient";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  PACKAGE_TYPES,
  packageTypeLabel,
  residentName,
  type CallDirection,
  type FamilyCallEntryRow,
  type PackageEntryRow,
  type PackageType,
  type QueryError,
  type QueryResult,
  type ResidentMini,
} from "@/lib/office/front-desk";
import { VISITABLE_RESIDENT_STATUSES, type VisitorSignInDraft } from "@/lib/registers/visitor-log";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type Tab = "visitors" | "packages" | "calls";

const TABS: { id: Tab; label: string; icon: typeof Users }[] = [
  { id: "visitors", label: "Visitors", icon: Users },
  { id: "packages", label: "Packages & mail", icon: PackageCheck },
  { id: "calls", label: "Family calls", icon: PhoneIncoming },
];

export default function AdminFrontDeskPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [tab, setTab] = useState<Tab>("visitors");
  const [residents, setResidents] = useState<ResidentMini[]>([]);
  const [onSiteCount, setOnSiteCount] = useState(0);
  const [organizationId, setOrganizationId] = useState("");
  const [packages, setPackages] = useState<PackageEntryRow[]>([]);
  const [calls, setCalls] = useState<FamilyCallEntryRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Package form
  const [pRecipient, setPRecipient] = useState("");
  const [pResident, setPResident] = useState("");
  const [pCarrier, setPCarrier] = useState("");
  const [pType, setPType] = useState<PackageType>("package");
  const [pDesc, setPDesc] = useState("");
  const [savingPackage, setSavingPackage] = useState(false);

  // Call form
  const [cResident, setCResident] = useState("");
  const [cCaller, setCCaller] = useState("");
  const [cRelationship, setCRelationship] = useState("");
  const [cDirection, setCDirection] = useState<CallDirection>("inbound");
  const [cSummary, setCSummary] = useState("");
  const [cFollowUp, setCFollowUp] = useState(false);
  const [savingCall, setSavingCall] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setPackages([]);
      setCalls([]);
      setResidents([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const fid = selectedFacilityId as string;
      const residentsQ = supabase
        .from("residents")
        .select("id, first_name, last_name, status")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("last_name");
      const packagesQ = supabase
        .from("package_log_entries" as never)
        .select(
          "id, resident_id, recipient_name, carrier, package_type, description, received_at, delivered_at, delivered_to_name",
        )
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("received_at", { ascending: false })
        .limit(100);
      const callsQ = supabase
        .from("family_call_log_entries" as never)
        .select(
          "id, resident_id, caller_name, relationship, direction, call_at, summary, follow_up_needed",
        )
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("call_at", { ascending: false })
        .limit(100);

      const [rRes, pRes, cRes] = await Promise.all([
        residentsQ as unknown as Promise<QueryResult<ResidentMini>>,
        packagesQ as unknown as Promise<QueryResult<PackageEntryRow>>,
        callsQ as unknown as Promise<QueryResult<FamilyCallEntryRow>>,
      ]);
      const err: QueryError | null = rRes.error ?? pRes.error ?? cRes.error;
      if (err) throw new Error(err.message);
      setResidents(rRes.data ?? []);
      setOrganizationId((await fetchActorContext(supabase))?.organizationId ?? "");
      setPackages(pRes.data ?? []);
      setCalls(cRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load front desk logs.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Signing a visitor in is the one write this page still makes directly. Sign
   * out, void and end of day go through the definer functions in migration 412
   * (COL-353): migration 294 let a client rewrite a visitor's name or arrival
   * time after the fact, and that UPDATE policy is gone.
   */
  const signInVisitor = useCallback(
    async (draft: VisitorSignInDraft) => {
      if (!facilityReady) return;
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("visitor_log_entries" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        visitor_name: draft.name.trim(),
        visitor_phone: draft.phone.trim() || null,
        visitor_type: draft.visitorType,
        visiting_type: draft.visitingType,
        resident_id: draft.visitingType === "resident" ? draft.residentId : null,
        signed_in_by: actor.userId,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
    },
    [supabase, facilityReady, selectedFacilityId],
  );

  const logPackage = useCallback(async () => {
    if (!facilityReady || !pRecipient.trim()) return;
    setSavingPackage(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("package_log_entries" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        resident_id: pResident || null,
        recipient_name: pRecipient.trim(),
        carrier: pCarrier.trim() || null,
        package_type: pType,
        description: pDesc.trim() || null,
        received_by: actor.userId,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setPRecipient("");
      setPResident("");
      setPCarrier("");
      setPDesc("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to log package.");
    } finally {
      setSavingPackage(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, pRecipient, pResident, pCarrier, pType, pDesc, load]);

  const markDelivered = useCallback(
    async (entry: PackageEntryRow) => {
      setBusyId(entry.id);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        const { error } = await supabase
          .from("package_log_entries" as never)
          .update({
            delivered_at: new Date().toISOString(),
            delivered_to_name: entry.recipient_name,
            delivered_by: actor?.userId,
            updated_by: actor?.userId,
          } as never)
          .eq("id", entry.id);
        if (error) throw new Error(error.message);
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to mark delivered.");
      } finally {
        setBusyId(null);
      }
    },
    [supabase, load],
  );

  const logCall = useCallback(async () => {
    if (!facilityReady || !cResident || !cCaller.trim() || !cSummary.trim()) return;
    setSavingCall(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("family_call_log_entries" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        resident_id: cResident,
        caller_name: cCaller.trim(),
        relationship: cRelationship.trim() || null,
        direction: cDirection,
        summary: cSummary.trim(),
        follow_up_needed: cFollowUp,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setCResident("");
      setCCaller("");
      setCRelationship("");
      setCSummary("");
      setCFollowUp(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to log call.");
    } finally {
      setSavingCall(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, cResident, cCaller, cRelationship, cDirection, cSummary, cFollowUp, load]);

  const visitableResidents = useMemo(
    () =>
      residents
        .filter((r) => VISITABLE_RESIDENT_STATUSES.includes(
          (r as ResidentMini & { status?: string }).status as (typeof VISITABLE_RESIDENT_STATUSES)[number],
        ))
        .map((r) => ({ id: r.id, firstName: r.first_name, lastName: r.last_name })),
    [residents],
  );
  const pendingPackages = useMemo(
    () => packages.filter((p) => !p.delivered_at).length,
    [packages],
  );

  const inputCls =
    "rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <Users className="h-8 w-8 text-info shrink-0" aria-hidden />
            Front desk
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Visitor sign-in with health screening, package &amp; mail custody, and the family
            phone-call log. {onSiteCount} on site · {pendingPackages} packages awaiting pickup.
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — front desk logs are per-facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady ? (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Front desk logs">
            {TABS.map((t) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                    active
                      ? "bg-primary text-primary-foreground"
                      : "bg-card text-muted-foreground border border-border hover:bg-muted",
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden />
                  {t.label}
                </button>
              );
            })}
          </div>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError && tab === "visitors" ? (
          <VisitorLogClient
            organizationId={organizationId}
            facilityId={facilityReady ? (selectedFacilityId as string) : null}
            residents={visitableResidents}
            onSignIn={signInVisitor}
            onOpenCountChange={setOnSiteCount}
          />
        ) : null}

        {facilityReady && !isLoading && !loadError && tab === "packages" ? (
          <section className="space-y-3">
            <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4 lg:grid-cols-3">
              <input type="text" value={pRecipient} onChange={(e) => setPRecipient(e.target.value)} placeholder="Recipient name" aria-label="Recipient name" className={inputCls} />
              <select value={pResident} onChange={(e) => { setPResident(e.target.value); const r = residents.find((x) => x.id === e.target.value); if (r) setPRecipient(`${r.first_name} ${r.last_name}`); }} aria-label="Resident" className={inputCls}>
                <option value="">Resident (optional)…</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>{r.last_name}, {r.first_name}</option>
                ))}
              </select>
              <select value={pType} onChange={(e) => setPType(e.target.value as PackageType)} aria-label="Package type" className={inputCls}>
                {PACKAGE_TYPES.map((p) => (
                  <option key={p.id} value={p.id}>{p.label}</option>
                ))}
              </select>
              <input type="text" value={pCarrier} onChange={(e) => setPCarrier(e.target.value)} placeholder="Carrier (optional)" aria-label="Carrier" className={inputCls} />
              <input type="text" value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder="Description (optional)" aria-label="Description" className={cn(inputCls, "lg:col-span-2")} />
              <Button type="button" disabled={savingPackage || !pRecipient.trim()} onClick={() => void logPackage()} className="gap-2">
                {savingPackage ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                Log package
              </Button>
            </div>

            {packages.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-2">No packages logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {packages.map((p) => (
                  <li key={p.id} className="flex flex-col gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold text-foreground truncate">{p.recipient_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {packageTypeLabel(p.package_type)}{p.carrier ? ` · ${p.carrier}` : ""} · received {ET_FMT.format(new Date(p.received_at))} ET
                        {p.description ? ` · ${p.description}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {p.delivered_at ? (
                        <StatusPill tone="success">delivered {ET_FMT.format(new Date(p.delivered_at))} ET</StatusPill>
                      ) : (
                        <Button type="button" variant="outline" size="sm" className="gap-2" disabled={busyId === p.id} onClick={() => void markDelivered(p)}>
                          <PackageCheck className="h-4 w-4" aria-hidden />
                          Mark delivered
                        </Button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}

        {facilityReady && !isLoading && !loadError && tab === "calls" ? (
          <section className="space-y-3">
            <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4 lg:grid-cols-3">
              <select value={cResident} onChange={(e) => setCResident(e.target.value)} aria-label="Resident" className={inputCls}>
                <option value="">Resident…</option>
                {residents.map((r) => (
                  <option key={r.id} value={r.id}>{r.last_name}, {r.first_name}</option>
                ))}
              </select>
              <input type="text" value={cCaller} onChange={(e) => setCCaller(e.target.value)} placeholder="Caller name" aria-label="Caller name" className={inputCls} />
              <input type="text" value={cRelationship} onChange={(e) => setCRelationship(e.target.value)} placeholder="Relationship (optional)" aria-label="Relationship" className={inputCls} />
              <select value={cDirection} onChange={(e) => setCDirection(e.target.value as CallDirection)} aria-label="Direction" className={inputCls}>
                <option value="inbound">Inbound</option>
                <option value="outbound">Outbound</option>
              </select>
              <input type="text" value={cSummary} onChange={(e) => setCSummary(e.target.value)} placeholder="Summary" aria-label="Summary" className={cn(inputCls, "lg:col-span-2")} />
              <label className="flex items-center gap-2 text-sm text-foreground lg:col-span-2">
                <input type="checkbox" checked={cFollowUp} onChange={(e) => setCFollowUp(e.target.checked)} />
                Follow-up needed
              </label>
              <Button type="button" disabled={savingCall || !cResident || !cCaller.trim() || !cSummary.trim()} onClick={() => void logCall()} className="gap-2">
                {savingCall ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                Log call
              </Button>
            </div>

            {calls.length === 0 ? (
              <p className="text-sm text-muted-foreground pl-2">No family calls logged yet.</p>
            ) : (
              <ul className="space-y-2">
                {calls.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex flex-col gap-0.5 min-w-0">
                      <span className="font-semibold text-foreground truncate">
                        {c.caller_name}
                        {c.relationship ? ` (${c.relationship})` : ""} · {residentName(c.resident_id, residents) ?? "resident"}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {c.direction} · {ET_FMT.format(new Date(c.call_at))} ET · {c.summary}
                      </span>
                    </div>
                    {c.follow_up_needed ? <StatusPill tone="warning">follow-up</StatusPill> : null}
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </div>
    </div>
  );
}
