"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { format, subDays, startOfQuarter } from "date-fns";
import { ClipboardList, Download, Search, Loader2, Mic } from "lucide-react";

import { ReferralsHubNav } from "@/app/(admin)/admin/referrals/referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { KpiCard, type KpiCardTone } from "@/components/ui/kpi-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import {
  facilityDatetimeLocalToUtcIso,
  nowFacilityDatetimeLocal,
} from "@/lib/facility-wall-clock";
import { Badge } from "@/components/ui/badge";
import {
  formatReferralsHubOutreachWeek,
  formatReferralsHubReferralSource,
  formatReferralsHubTourScheduledFor,
  REFERRALS_HUB_NO_TOUR_TIME_COPY,
  referralsHubKpiTileValue,
  type ReferralsHubKpiContext,
} from "@/lib/referrals/referrals-hub-display-copy";
import {
  loadReferralsHubBootstrap,
  REFERRAL_UPCOMING_TOUR_LIMIT,
  type ReferralsActiveAdmissionCase,
  type ReferralsHandoffPhase,
  type ReferralsHandoffRollup,
  type ReferralsHubBootstrap,
  type ReferralsHubLeadRow,
  type ReferralsHubUpcomingTourRow,
  type ReferralsOutreachRow,
  type ReferralLeadStatus,
} from "@/lib/referrals/referrals-hub-bootstrap";

type LeadRow = ReferralsHubLeadRow;
type UpcomingTourRow = ReferralsHubUpcomingTourRow;
type HandoffPhase = ReferralsHandoffPhase;
type ActiveAdmissionCase = ReferralsActiveAdmissionCase;
type OutreachRow = ReferralsOutreachRow;

const LEAD_STATUS_FILTERS: { value: "all" | ReferralLeadStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "tour_scheduled", label: "Tour scheduled" },
  { value: "tour_completed", label: "Tour completed" },
  { value: "application_pending", label: "Application pending" },
  { value: "waitlisted", label: "Waitlisted" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
  { value: "merged", label: "Merged" },
];

const REFERRAL_PIPELINE_DISPLAY_LIMIT = 60;

type LeadExportRow = Database["public"]["Tables"]["referral_leads"]["Row"] & {
  referral_sources: { name: string } | null;
};

type ReferralKpiScope = "7d" | "30d" | "quarter" | "all";

function kpiScopeRange(key: ReferralKpiScope, now = new Date()): { start: Date; end: Date } | null {
  switch (key) {
    case "7d":
      return { start: subDays(now, 7), end: now };
    case "30d":
      return { start: subDays(now, 30), end: now };
    case "quarter":
      return { start: startOfQuarter(now), end: now };
    case "all":
    default:
      return null;
  }
}

/** Inclusive of start/end timestamps (facility-local ordering via ISO strings). */
function tsInRange(iso: string, range: { start: Date; end: Date }): boolean {
  const t = new Date(iso).getTime();
  return t >= range.start.getTime() && t <= range.end.getTime();
}

/** Length-matched interval immediately before `range`. */
function priorAdjacentRange(range: { start: Date; end: Date }): { start: Date; end: Date } {
  const ms = range.end.getTime() - range.start.getTime();
  const end = new Date(range.start.getTime());
  const start = new Date(end.getTime() - ms);
  return { start, end };
}

function buildReferralLeadsCsv(rows: LeadExportRow[]): string {
  const header = [
    "id",
    "organization_id",
    "facility_id",
    "first_name",
    "last_name",
    "preferred_name",
    "status",
    "email",
    "phone",
    "date_of_birth",
    "referral_source_id",
    "referral_source_name",
    "external_reference",
    "converted_resident_id",
    "converted_at",
    "notes",
    "pii_access_tier",
    "merged_at",
    "merged_by",
    "merged_into_lead_id",
    "created_at",
    "updated_at",
    "created_by",
    "updated_by",
  ].join(",");
  const body = rows.map((row) =>
    [
      csvEscapeCell(row.id),
      csvEscapeCell(row.organization_id),
      csvEscapeCell(row.facility_id),
      csvEscapeCell(row.first_name),
      csvEscapeCell(row.last_name),
      csvEscapeCell(row.preferred_name ?? ""),
      csvEscapeCell(row.status),
      csvEscapeCell(row.email ?? ""),
      csvEscapeCell(row.phone ?? ""),
      csvEscapeCell(row.date_of_birth ?? ""),
      csvEscapeCell(row.referral_source_id ?? ""),
      csvEscapeCell(row.referral_sources?.name ?? ""),
      csvEscapeCell(row.external_reference ?? ""),
      csvEscapeCell(row.converted_resident_id ?? ""),
      csvEscapeCell(row.converted_at ?? ""),
      csvEscapeCell(row.notes ?? ""),
      csvEscapeCell(row.pii_access_tier),
      csvEscapeCell(row.merged_at ?? ""),
      csvEscapeCell(row.merged_by ?? ""),
      csvEscapeCell(row.merged_into_lead_id ?? ""),
      csvEscapeCell(row.created_at),
      csvEscapeCell(row.updated_at),
      csvEscapeCell(row.created_by ?? ""),
      csvEscapeCell(row.updated_by ?? ""),
    ].join(","),
  );
  return [header, ...body].join("\r\n");
}

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

function leadPriority(status: ReferralLeadStatus, handoffPhase: HandoffPhase | null): number {
  if (handoffPhase === "blocked") return 0;
  if (handoffPhase === "ready") return 1;
  if (handoffPhase === "onboarding") return 2;
  if (status === "new") return 3;
  if (status === "contacted") return 4;
  if (status === "tour_scheduled") return 5;
  if (status === "tour_completed") return 6;
  if (status === "application_pending") return 7;
  if (status === "waitlisted") return 8;
  if (status === "converted") return 9;
  if (status === "lost") return 10;
  return 11;
}

export type AdminReferralsPageClientProps = {
  initialBootstrap: ReferralsHubBootstrap;
  initialLoadError: string | null;
  initialFacilityId: string | null;
  serverBootstrapped?: boolean;
};

export function AdminReferralsPageClient({
  initialBootstrap,
  initialLoadError,
  initialFacilityId,
  serverBootstrapped = false,
}: AdminReferralsPageClientProps) {
  const supabase = createClient();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();
  const skipNextLoadRef = useRef(serverBootstrapped && initialLoadError == null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(initialLoadError);
  const [rows, setRows] = useState<LeadRow[]>(initialBootstrap.rows);
  const [upcomingTours, setUpcomingTours] = useState<UpcomingTourRow[]>(initialBootstrap.upcomingTours);
  const [activeAdmissionCaseByLeadId, setActiveAdmissionCaseByLeadId] = useState<
    Record<string, ActiveAdmissionCase>
  >(initialBootstrap.activeAdmissionCaseByLeadId);
  const [handoffRollup, setHandoffRollup] = useState<ReferralsHandoffRollup>(initialBootstrap.handoffRollup);
  const [hl7Counts, setHl7Counts] = useState(initialBootstrap.hl7Counts);
  const [exportingCsv, setExportingCsv] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | ReferralLeadStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [kpiScope, setKpiScope] = useState<ReferralKpiScope>("30d");
  const [outreachRows, setOutreachRows] = useState<OutreachRow[]>(initialBootstrap.outreachRows);
  const [outreachStatusDrafts, setOutreachStatusDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(initialBootstrap.outreachRows.map((row) => [row.id, row.status])),
  );
  const [activityType, setActivityType] = useState("provider_visit");
  const [activityStatus, setActivityStatus] = useState("planned");
  const [scheduledFor, setScheduledFor] = useState(() => nowFacilityDatetimeLocal());
  const [partnerName, setPartnerName] = useState("");
  const [activityNotes, setActivityNotes] = useState("");
  const [savingActivity, setSavingActivity] = useState(false);

  const filteredRows = useMemo(() => {
    if (statusFilter === "all") return rows;
    return rows.filter((r) => r.status === statusFilter);
  }, [rows, statusFilter]);

  const displayRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return filteredRows;
    return filteredRows.filter((r) => {
      const hay = [
        r.first_name,
        r.last_name,
        r.email,
        r.phone,
        r.external_reference,
        r.notes,
        r.referral_sources?.name,
        r.id,
        r.status,
      ]
        .filter((s): s is string => typeof s === "string" && s.length > 0)
        .join("\n")
        .toLowerCase();
      return hay.includes(q);
    });
  }, [filteredRows, searchQuery]);

  const featuredRows = useMemo(() => {
    return [...displayRows]
      .sort((a, b) => {
        const phaseA = activeAdmissionCaseByLeadId[a.id]?.phase ?? null;
        const phaseB = activeAdmissionCaseByLeadId[b.id]?.phase ?? null;
        const priorityDelta = leadPriority(a.status, phaseA) - leadPriority(b.status, phaseB);
        if (priorityDelta !== 0) return priorityDelta;
        return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
      })
      .slice(0, REFERRAL_PIPELINE_DISPLAY_LIMIT);
  }, [activeAdmissionCaseByLeadId, displayRows]);


  const applyBootstrap = useCallback((bootstrap: ReferralsHubBootstrap) => {
    setRows(bootstrap.rows);
    setUpcomingTours(bootstrap.upcomingTours);
    setOutreachRows(bootstrap.outreachRows);
    setOutreachStatusDrafts(
      Object.fromEntries(bootstrap.outreachRows.map((row) => [row.id, row.status])),
    );
    setActiveAdmissionCaseByLeadId(bootstrap.activeAdmissionCaseByLeadId);
    setHandoffRollup(bootstrap.handoffRollup);
    setHl7Counts(bootstrap.hl7Counts);
  }, []);

  const load = useCallback(async () => {
    if (skipNextLoadRef.current && selectedFacilityId === initialFacilityId) {
      skipNextLoadRef.current = false;
      return;
    }
    skipNextLoadRef.current = false;

    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      applyBootstrap({
        rows: [],
        upcomingTours: [],
        outreachRows: [],
        activeAdmissionCaseByLeadId: {},
        handoffRollup: { blocked: 0, ready: 0, onboarding: 0 },
        hl7Counts: { pending: 0, failed: 0 },
      });
      setLoading(false);
      return;
    }

    try {
      const bootstrap = await loadReferralsHubBootstrap(selectedFacilityId, supabase);
      applyBootstrap(bootstrap);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load referrals.");
      applyBootstrap({
        rows: [],
        upcomingTours: [],
        outreachRows: [],
        activeAdmissionCaseByLeadId: {},
        handoffRollup: { blocked: 0, ready: 0, onboarding: 0 },
        hl7Counts: { pending: 0, failed: 0 },
      });
    } finally {
      setLoading(false);
    }
  }, [applyBootstrap, initialFacilityId, selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const exportReferralLeadsCsv = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    setExportingCsv(true);
    setLoadError(null);
    try {
      let query = supabase
        .from("referral_leads")
        .select("*, referral_sources(name)")
        .eq("facility_id", selectedFacilityId)
        .is("deleted_at", null)
        .order("updated_at", { ascending: false })
        .limit(500);
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter);
      }
      const { data, error: qErr } = await query;
      if (qErr) throw qErr;
      const list = (data ?? []) as LeadExportRow[];
      const csv = buildReferralLeadsCsv(list);
      const stamp = format(new Date(), "yyyy-MM-dd");
      const base = `referral-leads-${stamp}`;
      const filename =
        statusFilter === "all" ? `${base}.csv` : `${base}_${statusFilter}.csv`;
      triggerCsvDownload(filename, csv);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to export referral leads.");
    } finally {
      setExportingCsv(false);
    }
  }, [supabase, selectedFacilityId, statusFilter]);

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  const selectedFacilityLabel = useMemo(() => {
    if (!selectedFacilityId) return null;
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? selectedFacilityId;
  }, [availableFacilities, selectedFacilityId]);

  const kpiMetrics = useMemo(() => {
    if (noFacility) return null;
    const range = kpiScopeRange(kpiScope);
    const inUpd = (r: LeadRow) => (!range ? true : tsInRange(r.updated_at, range));
    const inCreatedRange = (r: LeadRow) => {
      if (!r.created_at) return !range;
      return !range ? true : tsInRange(r.created_at, range);
    };
    const conversionTs = (r: LeadRow) => r.converted_at ?? r.updated_at;

    const newLeads = !range
      ? rows.filter((r) => r.status === "new").length
      : rows.filter((r) => inCreatedRange(r)).length;

    const activePipeline = rows.filter(
      (r) => !["converted", "lost", "merged"].includes(r.status) && inUpd(r),
    ).length;

    const needsAttention = rows.filter(
      (r) => ["new", "contacted"].includes(r.status) && inUpd(r),
    ).length;

    const inAdmissions = rows.filter(
      (r) => Boolean(activeAdmissionCaseByLeadId[r.id]) && inUpd(r),
    ).length;

    const conversions = rows.filter(
      (r) => r.status === "converted" && (!range ? true : tsInRange(conversionTs(r), range)),
    ).length;

    const sumScoped = newLeads + activePipeline + inAdmissions + conversions + needsAttention;

    let convTone: KpiCardTone = "neutral";
    let convFootnote: ReactNode | undefined;
    let newFootnote: ReactNode | undefined;

    if (range) {
      const prevR = priorAdjacentRange(range);

      const convPrior = rows.filter(
        (r) => r.status === "converted" && tsInRange(conversionTs(r), prevR),
      ).length;
      const convCurr = conversions;
      if (convCurr > convPrior && convCurr > 0) convTone = "success";
      else if (convCurr < convPrior && convCurr > 0) convTone = "warning";

      convFootnote = (
        <>
          Previous window{" "}
          <span className={cn("tabular-nums", convCurr >= convPrior ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400")}>{convPrior}</span>
        </>
      );

      const newCurr = rows.filter((r) => inCreatedRange(r)).length;
      const newPrior = rows.filter((r) => r.created_at && tsInRange(r.created_at, prevR)).length;
      newFootnote = (
        <>
          Previous window{" "}
          <span
            className={cn(
              "tabular-nums",
              newCurr > newPrior ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground",
            )}
          >
            {newPrior}
          </span>
        </>
      );
    }

    let needsTone: KpiCardTone = "neutral";
    if (needsAttention >= 10) needsTone = "danger";
    else if (needsAttention > 0) needsTone = "warning";

    return {
      newLeads,
      activePipeline,
      needsAttention,
      inAdmissions,
      conversions,
      sumScoped,
      convTone,
      needsTone,
      convFootnote,
      newFootnote,
    };
  }, [activeAdmissionCaseByLeadId, kpiScope, noFacility, rows]);

  const allKpisZero =
    Boolean(kpiMetrics) && !loading && (kpiMetrics?.sumScoped ?? 1) === 0;

  const recentOutreach = useMemo(() => outreachRows.slice(0, 5), [outreachRows]);

  const admissionActiveTotal = Object.keys(activeAdmissionCaseByLeadId).length;

  const handoffCardMuted = handoffRollup.blocked === 0;
  const hl7NeedsReview = hl7Counts.failed > 0;

  const kpiCtx: ReferralsHubKpiContext = {
    loading,
    loadFailed: Boolean(loadError),
  };

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8 pb-28 pt-4">
      <header className="space-y-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-2">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">Referrals CRM</h1>
            <p className="max-w-prose text-[13px] leading-relaxed text-muted-foreground">
              Inquiries and pipeline before admission — attribution, follow-up, and conversion for{" "}
              {selectedFacilityLabel ? (
                <span className="font-medium text-foreground">{selectedFacilityLabel}</span>
              ) : (
                "the selected facility"
              )}
              .
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!noFacility ? (
              <Select value={kpiScope} onValueChange={(v) => setKpiScope(v as ReferralKpiScope)}>
                <SelectTrigger className="h-9 w-[164px]" aria-label="KPI time scope">
                  <SelectValue placeholder="Scope" />
                </SelectTrigger>
                <SelectContent align="end">
                  <SelectItem value="7d">Last 7 days</SelectItem>
                  <SelectItem value="30d">Last 30 days</SelectItem>
                  <SelectItem value="quarter">This quarter</SelectItem>
                  <SelectItem value="all">All time</SelectItem>
                </SelectContent>
              </Select>
            ) : null}
            {!noFacility ? (
              <Link href="/admin/referrals/new" className={cn(buttonVariants({ variant: "secondary" }))}>
                Add lead
              </Link>
            ) : (
              <Button variant="secondary" disabled>
                Add lead
              </Button>
            )}
          </div>
        </div>
        <ReferralsHubNav />
      </header>

      {noFacility ? (
        <div
          role="status"
          className="rounded-xl border border-amber-500/25 bg-amber-500/[0.08] px-4 py-3 text-sm text-amber-800 dark:text-amber-400"
        >
          Select a facility in the header to load referral leads and KPIs for that site.
        </div>
      ) : null}

      {!noFacility ? (
        <section aria-label="Referral KPIs">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <KpiCard
              value={referralsHubKpiTileValue("new_leads", kpiMetrics?.newLeads, kpiCtx)}
              label={kpiScope === "all" ? "Open new-status leads" : "Leads created in scope"}
              tone="neutral"
              footnote={kpiMetrics?.newFootnote}
            />
            <KpiCard
              value={referralsHubKpiTileValue("active_pipeline", kpiMetrics?.activePipeline, kpiCtx)}
              label="Active pipeline (touched in scope)"
              tone="neutral"
            />
            <KpiCard
              value={referralsHubKpiTileValue("needs_attention", kpiMetrics?.needsAttention, kpiCtx)}
              label="Needs attention (new · contacted)"
              tone={loading || !kpiMetrics ? "neutral" : kpiMetrics.needsTone}
            />
            <KpiCard
              value={referralsHubKpiTileValue("conversions", kpiMetrics?.conversions, kpiCtx)}
              label="Converted in scope"
              tone={loading || !kpiMetrics ? "neutral" : kpiMetrics.convTone}
              footnote={kpiMetrics?.convFootnote}
            />
            <KpiCard
              value={referralsHubKpiTileValue("in_admissions", kpiMetrics?.inAdmissions, kpiCtx)}
              label="In admissions (touched in scope)"
              tone="neutral"
            />
          </div>
        </section>
      ) : null}

      {allKpisZero ? (
        <Card className="border-dashed border-border/80">
          <CardContent className="pt-6 text-center text-[13px] text-muted-foreground">
            Nothing is moving in this window yet — add a{" "}
            <Link href="/admin/referrals/new" className="font-medium text-foreground underline-offset-4 hover:underline">
              new lead
            </Link>{" "}
            or widen the KPI scope.
          </CardContent>
        </Card>
      ) : null}

      {!noFacility ? (
        <div className="border-border rounded-lg bg-card shadow-sm overflow-hidden p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-bold text-foreground tracking-tight">Next scheduled tours</p>
              <p className="mt-1 text-sm text-muted-foreground tracking-wide">
                Showing the next {REFERRAL_UPCOMING_TOUR_LIMIT} scheduled tours from lead records for the standup forecast.
              </p>
            </div>
            <Badge className="border-none bg-primary/10 text-primary">Standup source</Badge>
          </div>

          {upcomingTours.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tours are currently scheduled in this facility pipeline.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {upcomingTours.map((row) => (
                <Link
                  key={row.id}
                  href={`/admin/referrals/${row.id}`}
                  className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                >
                  <div className="flex items-center justify-between gap-3 w-full">
                    <div>
                      <div className="text-[13px] text-foreground font-medium">{row.first_name} {row.last_name}</div>
                      <div className="text-[12px] font-medium capitalize text-muted-foreground">{formatStatus(row.status)}</div>
                    </div>
                    <div className="text-[12px] text-muted-foreground tabular-nums">
                      {formatReferralsHubTourScheduledFor(row.tour_scheduled_for)}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!noFacility ? (
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b border-border px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-[15px] font-medium tracking-tight text-foreground">Outreach and provider activity</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">
                Log outreach so weekly stand-ups reference the same ledger instead of rewriting work in chat.
              </p>
            </div>
            <Badge className="shrink-0 border-none bg-primary/10 text-primary">Stand-up source</Badge>
          </div>

          <div className="grid gap-8 p-5 lg:grid-cols-[1fr_1fr]">
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="crm-activity-type" className="text-[13px]">
                    Activity type
                  </Label>
                  <Select value={activityType} onValueChange={setActivityType}>
                    <SelectTrigger id="crm-activity-type" className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="provider_visit">Provider visit</SelectItem>
                      <SelectItem value="home_health_provider">Home health provider</SelectItem>
                      <SelectItem value="facility_outreach">Facility outreach</SelectItem>
                      <SelectItem value="community_event">Community event</SelectItem>
                      <SelectItem value="digital_outreach">Digital outreach</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="crm-activity-status" className="text-[13px]">
                    Status
                  </Label>
                  <Select value={activityStatus} onValueChange={setActivityStatus}>
                    <SelectTrigger id="crm-activity-status" className="h-10 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="planned">Planned</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-activity-datetime" className="text-[13px]">
                  Scheduled date and time (ET)
                </Label>
                <Input
                  id="crm-activity-datetime"
                  type="datetime-local"
                  className="h-10"
                  value={scheduledFor}
                  onChange={(e) => setScheduledFor(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="crm-activity-partner" className="text-[13px]">
                  Partner / facility / event name
                </Label>
                <Input
                  id="crm-activity-partner"
                  placeholder="Who or what you met with"
                  className="h-10"
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                />
              </div>
              <div className="relative space-y-2">
                <Label htmlFor="crm-activity-notes" className="text-[13px]">
                  Notes
                </Label>
                <textarea
                  id="crm-activity-notes"
                  rows={4}
                  placeholder="What was discussed, follow-ups, or context for the team"
                  className="min-h-[100px] w-full resize-y rounded-lg border border-input bg-background py-2 pl-3 pr-10 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
                  value={activityNotes}
                  onChange={(e) => setActivityNotes(e.target.value)}
                />
                <span
                  className="pointer-events-none absolute bottom-2 right-2 text-muted-foreground"
                  title="Dictation can be wired to your device microphone in a future pass"
                  aria-hidden
                >
                  <Mic className="size-4 opacity-70" />
                </span>
              </div>
              <div className="flex justify-end">
                <Button
                  type="button"
                  className="min-w-[8rem]"
                  disabled={savingActivity}
                  onClick={() =>
                    void createOutreachActivity({
                      supabase,
                      selectedFacilityId,
                      activityType,
                      activityStatus,
                      scheduledFor,
                      partnerName,
                      activityNotes,
                      setLoadError,
                      setSavingActivity,
                      onSaved: async () => {
                        setPartnerName("");
                        setActivityNotes("");
                        await load();
                      },
                    })
                  }
                >
                  {savingActivity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Save activity
                </Button>
              </div>
            </div>

            <div className="space-y-3">
              <p className="text-[13px] font-medium text-foreground">Recent activity</p>
              {outreachRows.length === 0 ? (
                <p className="text-[13px] text-muted-foreground">No outreach logged yet for this facility.</p>
              ) : (
                <ul className="space-y-3">
                  {recentOutreach.map((row) => (
                    <li
                      key={row.id}
                      className="rounded-lg border border-border bg-background/40 px-3 py-3 text-[13px]"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-medium text-foreground">
                            {row.external_partner_name ?? row.activity_type.replace(/_/g, " ")}
                          </p>
                          <p className="mt-0.5 text-[12px] capitalize text-muted-foreground">
                            {row.activity_type.replace(/_/g, " ")} · {row.status}
                          </p>
                        </div>
                        <p className="shrink-0 text-[12px] tabular-nums text-muted-foreground">
                          {row.scheduled_for
                            ? new Date(row.scheduled_for).toLocaleString(undefined, {
                                dateStyle: "medium",
                                timeStyle: "short",
                              })
                            : formatReferralsHubOutreachWeek(row.performed_for_week)}
                        </p>
                      </div>
                      {row.notes ? <p className="mt-2 text-[12px] leading-snug text-muted-foreground">{row.notes}</p> : null}
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Select
                          value={outreachStatusDrafts[row.id] ?? row.status}
                          onValueChange={(v) =>
                            setOutreachStatusDrafts((current) => ({ ...current, [row.id]: v }))
                          }
                        >
                          <SelectTrigger className="h-8 w-[140px] text-xs" aria-label={`Status for activity ${row.id}`}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="planned">Planned</SelectItem>
                            <SelectItem value="completed">Completed</SelectItem>
                            <SelectItem value="cancelled">Cancelled</SelectItem>
                          </SelectContent>
                        </Select>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={savingActivity || (outreachStatusDrafts[row.id] ?? row.status) === row.status}
                          onClick={() =>
                            void updateOutreachActivityStatus({
                              supabase,
                              activityId: row.id,
                              status: outreachStatusDrafts[row.id] ?? row.status,
                              setLoadError,
                              setSavingActivity,
                              onSaved: load,
                            })
                          }
                        >
                          Save status
                        </Button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!noFacility ? (
        <Card
          className={cn(
            "overflow-hidden",
            !handoffCardMuted ? "border-amber-500/35 bg-amber-500/[0.04]" : "",
          )}
        >
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[15px] font-medium text-foreground">Admissions handoff</p>
              <p className="text-[13px] text-muted-foreground">
                {loading
                  ? "Loading handoff rollup…"
                  : `${admissionActiveTotal} referral lead${admissionActiveTotal === 1 ? "" : "s"} tied to an active admission case in this facility.`}
              </p>
              {!loading && admissionActiveTotal > 0 ? (
                <p className="text-[12px] tabular-nums text-muted-foreground">
                  {handoffRollup.blocked} blocked · {handoffRollup.ready} ready · {handoffRollup.onboarding} onboarding
                </p>
              ) : null}
            </div>
            <Link
              href="/admin/referrals/in-admissions"
              className={cn(buttonVariants({ variant: "outline" }), "w-full justify-center sm:w-auto")}
            >
              Open handoff queue
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {!noFacility ? (
        <Card
          className={cn(
            "overflow-hidden",
            hl7NeedsReview ? "border-amber-500/35 bg-amber-500/[0.04]" : "",
          )}
        >
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-1">
              <p className="text-[15px] font-medium text-foreground">Referral inbox (HL7 ADT)</p>
              <p className="text-[13px] text-muted-foreground">
                {loading
                  ? "Loading queue counts…"
                  : `Pending ${hl7Counts.pending}, failed ${hl7Counts.failed}. Open the inbox to triage, replay, or discard messages — this count is facility-scoped.`}
              </p>
            </div>
            <Link
              href="/admin/referrals/hl7-inbound"
              className={cn(buttonVariants({ variant: "outline" }), "w-full justify-center sm:w-auto")}
            >
              Open referral inbox
            </Link>
          </CardContent>
        </Card>
      ) : null}

      {/* ─── CASE ROSTER (GLASS ROWS) ─── */}
      <div className="space-y-6">
        <div className="flex flex-col gap-3 border-b border-border pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-5 w-5 shrink-0 text-primary" aria-hidden />
              <div>
                <h2 className="text-lg font-medium tracking-tight text-foreground">Pipeline</h2>
                <p className="mt-0.5 text-[13px] text-muted-foreground">
                  Priority-ranked subset; open a row for the full lead timeline.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={noFacility || exportingCsv}
              className="h-9 shrink-0 gap-2 sm:self-start"
              title={
                (statusFilter === "all"
                  ? "Export up to 500 leads (all statuses), most recently updated first."
                  : `Export up to 500 ${statusFilter.replace(/_/g, " ")} leads, most recently updated first.`) +
                " Search does not narrow the CSV."
              }
              onClick={() => void exportReferralLeadsCsv()}
            >
              <Download className="h-4 w-4" aria-hidden />
              {exportingCsv ? "Preparing…" : "Download CSV"}
            </Button>
          </div>
          {!noFacility ? (
            <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
              <label className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:max-w-md">
                <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                <Input
                  type="search"
                  placeholder="Search name, phone, email, source, external ref…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 rounded-lg border-input bg-background text-sm text-foreground"
                  aria-label="Filter pipeline by text"
                />
              </label>
              <div className="flex flex-col gap-2 sm:min-w-[200px]">
                <Label htmlFor="crm-pipeline-status" className="text-[12px] font-medium text-muted-foreground">
                  Status
                </Label>
                <Select
                  value={statusFilter}
                  onValueChange={(v) => setStatusFilter(v as "all" | ReferralLeadStatus)}
                >
                  <SelectTrigger id="crm-pipeline-status" className="h-9 w-full bg-background shadow-xs">
                    <SelectValue placeholder="Filter by status" />
                  </SelectTrigger>
                  <SelectContent>
                    {LEAD_STATUS_FILTERS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {rows.length > 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  {searchQuery.trim() ? (
                    <>
                      Showing {featuredRows.length} of {displayRows.length} matching search.
                    </>
                  ) : (
                    <>
                      Showing {featuredRows.length} priority-ranked rows of {rows.length} loaded.
                    </>
                  )}
                </p>
              ) : null}
            </div>
          ) : null}
        </div>

        {loadError ? (
           <p className="text-sm text-rose-600 dark:text-rose-400" role="alert">{loadError}</p>
        ) : null}

        <div className="border-border rounded-lg bg-card shadow-sm overflow-hidden p-6 md:p-8 relative">
           <div className="hidden lg:flex items-center gap-3 border-b border-border bg-card/60 px-[13px] py-2 text-[12px] font-semibold capitalize text-muted-foreground">
             <div className="flex-[2]">Lead name</div>
             <div className="flex-1">Status</div>
             <div className="flex-1 text-right">Source</div>
             <div className="flex-1 text-right">Updated</div>
           </div>

           <div className="space-y-4 mt-4">
             {noFacility ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Select a facility to view leads.
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground">
                 Loading pipeline...
               </div>
             ) : rows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                 No leads yet. Starts with <strong>New lead</strong>.
               </div>
             ) : filteredRows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                 No leads match this status filter.
               </div>
             ) : displayRows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-muted-foreground bg-muted rounded-lg border border-dashed border-border">
                 No leads match this search.
               </div>
             ) : (
                <div className="space-y-3">
                 {featuredRows.map((r) => {
                    const isNew = r.status === "new";
                    const linkedAdmission = activeAdmissionCaseByLeadId[r.id] ?? null;
                    const linkedAdmissionCaseId = linkedAdmission?.id ?? null;
                    const handoffPhase = linkedAdmission?.phase ?? null;
                    
                    return (
                        <Link
                          key={r.id}
                          href={`/admin/referrals/${r.id}`}
                          className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card tap-responsive group hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] w-full cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-8 h-8 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                              {isNew ? <></> : <div className="w-2 h-2 rounded-full bg-primary" />}
                            </div>
                            <span className="text-[13px] font-semibold text-foreground truncate tracking-tight">
                               {r.first_name} {r.last_name}
                            </span>
                          </div>
                          
                          <div className="flex flex-row justify-between lg:justify-start items-center">
                            <span className="lg:hidden text-[12px] font-medium text-muted-foreground">Status</span>
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[11px] font-semibold capitalize px-2.5 py-1 rounded-full border",
                                isNew ? "bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-400" : "bg-muted/60 text-foreground border-border"
                              )}>
                                {formatStatus(r.status)}
                              </span>
                              {linkedAdmissionCaseId ? (
                                <span className="text-[11px] font-medium rounded-full border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-amber-800 dark:text-amber-300">
                                  In admissions
                                </span>
                              ) : null}
                              {handoffPhase === "blocked" ? (
                                <span className="text-[11px] font-medium rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-amber-800 dark:text-amber-300">
                                  Blocked
                                </span>
                              ) : handoffPhase === "ready" ? (
                                <span className="text-[11px] font-medium rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-1 text-emerald-800 dark:text-emerald-300">
                                  Ready
                                </span>
                              ) : handoffPhase === "onboarding" ? (
                                <span className="text-[11px] font-medium rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-primary">
                                  Onboarding
                                </span>
                              ) : null}
                            </div>
                          </div>
                          
                          <div className="flex flex-row justify-between lg:justify-end items-center">
                            <span className="lg:hidden text-[12px] font-medium text-muted-foreground">Source</span>
                            <span className="text-[13px] text-foreground truncate">
                              {formatReferralsHubReferralSource(r.referral_sources?.name)}
                            </span>
                          </div>

                          <div className="flex flex-row justify-between lg:justify-end items-center">
                            <span className="lg:hidden text-[12px] font-medium text-muted-foreground">Updated</span>
                          <div className="flex flex-col items-end">
                            <span className="text-[12px] font-mono tracking-wide tabular-nums text-muted-foreground">
                              {new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                            {(() => {
                              const tourLabel = formatReferralsHubTourScheduledFor(r.tour_scheduled_for);
                              const hasTourTime = tourLabel !== REFERRALS_HUB_NO_TOUR_TIME_COPY;
                              return (
                                <span
                                  className={cn(
                                    "text-[12px] tabular-nums",
                                    hasTourTime ? "text-primary" : "text-muted-foreground",
                                  )}
                                >
                                  {hasTourTime ? `Tour ${tourLabel}` : tourLabel}
                                </span>
                              );
                            })()}
                            {linkedAdmissionCaseId ? (
                              <span className="text-[12px] text-amber-700 dark:text-amber-300">
                                {handoffPhase === "blocked"
                                    ? "Admissions handoff blocked"
                                    : handoffPhase === "ready"
                                      ? "Admissions handoff ready"
                                      : handoffPhase === "onboarding"
                                        ? "Onboarding handoff pending"
                                        : "Admission case active"}
                                </span>
                              ) : null}
                            </div>
                          </div>
                        </Link>
                    )
                  })}
                </div>
             )}
           </div>
        </div>
      </div>

    </div>
  );
}

async function createOutreachActivity(input: {
  supabase: ReturnType<typeof createClient>;
  selectedFacilityId: string | null;
  activityType: string;
  activityStatus: string;
  scheduledFor: string;
  partnerName: string;
  activityNotes: string;
  setLoadError: (value: string | null) => void;
  setSavingActivity: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const {
    supabase,
    selectedFacilityId,
    activityType,
    activityStatus,
    scheduledFor,
    partnerName,
    activityNotes,
    setLoadError,
    setSavingActivity,
    onSaved,
  } = input;
  if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
  setSavingActivity(true);
  setLoadError(null);
  try {
    const facilityRes = await supabase
      .from("facilities" as never)
      .select("organization_id")
      .eq("id", selectedFacilityId)
      .is("deleted_at", null)
      .maybeSingle() as unknown as { data: { organization_id: string } | null; error: { message: string } | null };
    if (facilityRes.error || !facilityRes.data?.organization_id) throw new Error("Could not resolve organization.");
    const authRes = await supabase.auth.getUser();
    const userId = authRes.data.user?.id;
    if (!userId) throw new Error("Sign in required.");

    const scheduledUtcIso = scheduledFor ? facilityDatetimeLocalToUtcIso(scheduledFor) : null;
    const weekStart = new Date(scheduledUtcIso ?? new Date().toISOString());
    const day = weekStart.getDay();
    const offset = day === 0 ? -6 : 1 - day;
    weekStart.setDate(weekStart.getDate() + offset);
    weekStart.setHours(0, 0, 0, 0);

    const insertRes = await supabase
      .from("referral_outreach_activities" as never)
      .insert({
        organization_id: facilityRes.data.organization_id,
        facility_id: selectedFacilityId,
        owner_user_id: userId,
        activity_type: activityType,
        status: activityStatus,
        scheduled_for: scheduledUtcIso,
        performed_for_week: weekStart.toISOString().slice(0, 10),
        external_partner_name: partnerName.trim() || null,
        notes: activityNotes.trim() || null,
        created_by: userId,
        updated_by: userId,
      } as never) as unknown as { error: { message: string } | null };
    if (insertRes.error) throw insertRes.error;
    await onSaved();
  } catch (err) {
    setLoadError(err instanceof Error ? err.message : "Could not save outreach activity.");
  } finally {
    setSavingActivity(false);
  }
}

async function updateOutreachActivityStatus(input: {
  supabase: ReturnType<typeof createClient>;
  activityId: string;
  status: string;
  setLoadError: (value: string | null) => void;
  setSavingActivity: (value: boolean) => void;
  onSaved: () => Promise<void>;
}) {
  const { supabase, activityId, status, setLoadError, setSavingActivity, onSaved } = input;
  setSavingActivity(true);
  setLoadError(null);
  try {
    const authRes = await supabase.auth.getUser();
    const userId = authRes.data.user?.id;
    if (!userId) throw new Error("Sign in required.");

    const res = await supabase
      .from("referral_outreach_activities" as never)
      .update({
        status,
        updated_by: userId,
      } as never)
      .eq("id", activityId) as unknown as { error: { message: string } | null };
    if (res.error) throw res.error;
    await onSaved();
  } catch (err) {
    setLoadError(err instanceof Error ? err.message : "Could not update outreach activity.");
  } finally {
    setSavingActivity(false);
  }
}
