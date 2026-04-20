"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import { ClipboardList, Download, Search, UserPlus, ArrowRight, Loader2 } from "lucide-react";

import { ReferralsHubNav } from "./referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { PulseDot } from "@/components/ui/moonshot/pulse-dot";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { csvEscapeCell, triggerCsvDownload } from "@/lib/csv-export";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

type ReferralLeadStatus = Database["public"]["Enums"]["referral_lead_status"];

type LeadRow = Pick<
  Database["public"]["Tables"]["referral_leads"]["Row"],
  | "id"
  | "first_name"
  | "last_name"
  | "status"
  | "updated_at"
  | "email"
  | "phone"
  | "external_reference"
  | "notes"
> & {
  tour_scheduled_for: string | null;
  tour_completed_at: string | null;
  referral_sources: { name: string } | null;
};

type HandoffPhase = "blocked" | "ready" | "onboarding" | "complete";

type ActiveAdmissionCase = {
  id: string;
  phase: HandoffPhase;
};

type AdmissionMini = {
  id: string;
  referral_lead_id: string | null;
  status: string;
  resident_id: string;
  target_move_in_date: string | null;
  financial_clearance_at: string | null;
  physician_orders_received_at: string | null;
  bed_id: string | null;
};

type OutreachRow = {
  id: string;
  activity_type: string;
  status: string;
  scheduled_for: string | null;
  performed_for_week: string | null;
  external_partner_name: string | null;
  notes: string | null;
};

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

type LeadExportRow = Database["public"]["Tables"]["referral_leads"]["Row"] & {
  referral_sources: { name: string } | null;
};

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

export default function AdminReferralsHubPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [rows, setRows] = useState<LeadRow[]>([]);
  const [activeAdmissionCaseByLeadId, setActiveAdmissionCaseByLeadId] = useState<Record<string, ActiveAdmissionCase>>({});
  const [counts, setCounts] = useState({
    new: 0,
    pipeline: 0,
    converted: 0,
    attention: 0,
    inAdmissions: 0,
    handoffBlocked: 0,
    handoffReady: 0,
    handoffOnboarding: 0,
  });
  const [hl7Counts, setHl7Counts] = useState({ pending: 0, failed: 0 });
  const [exportingCsv, setExportingCsv] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"all" | ReferralLeadStatus>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [outreachRows, setOutreachRows] = useState<OutreachRow[]>([]);
  const [outreachStatusDrafts, setOutreachStatusDrafts] = useState<Record<string, string>>({});
  const [activityType, setActivityType] = useState("provider_visit");
  const [activityStatus, setActivityStatus] = useState("planned");
  const [scheduledFor, setScheduledFor] = useState(() => new Date().toISOString().slice(0, 16));
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
      .slice(0, 60);
  }, [activeAdmissionCaseByLeadId, displayRows]);

  const upcomingTours = useMemo(() => {
    return rows
      .filter((row) => row.tour_scheduled_for && row.status !== "lost" && row.status !== "merged")
      .sort((a, b) => new Date(a.tour_scheduled_for!).getTime() - new Date(b.tour_scheduled_for!).getTime())
      .slice(0, 6);
  }, [rows]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setCounts({ new: 0, pipeline: 0, converted: 0, attention: 0, inAdmissions: 0, handoffBlocked: 0, handoffReady: 0, handoffOnboarding: 0 });
      setHl7Counts({ pending: 0, failed: 0 });
      setActiveAdmissionCaseByLeadId({});
      setLoading(false);
      return;
    }

    try {
      const [{ data: list, error: listErr }, { data: outreachList, error: outreachErr }] = await Promise.all([
        (supabase
          .from("referral_leads" as never)
          .select(
            "id, first_name, last_name, status, updated_at, email, phone, external_reference, notes, tour_scheduled_for, tour_completed_at, referral_sources(name)",
          )
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })) as unknown as Promise<{ data: LeadRow[] | null; error: { message: string } | null }>,
        supabase
          .from("referral_outreach_activities" as never)
          .select("id, activity_type, status, scheduled_for, performed_for_week, external_partner_name, notes")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("scheduled_for", { ascending: false })
          .limit(8),
      ]);

      if (listErr) throw listErr;
      if (outreachErr) throw outreachErr;
      const leadRows = (list ?? []) as LeadRow[];
      setRows(leadRows);
      setOutreachRows((outreachList ?? []) as OutreachRow[]);
      setOutreachStatusDrafts(Object.fromEntries(((outreachList ?? []) as OutreachRow[]).map((row) => [row.id, row.status])));

      const leadIds = leadRows.map((row) => row.id);
      let inAdmissionsCount = 0;
      let handoffBlocked = 0;
      let handoffReady = 0;
      let handoffOnboarding = 0;
      if (leadIds.length > 0) {
        const { data: admissionCases, error: admissionErr } = await supabase
          .from("admission_cases")
          .select("id, referral_lead_id, status, resident_id, target_move_in_date, financial_clearance_at, physician_orders_received_at, bed_id")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .in("referral_lead_id", leadIds)
          .not("status", "eq", "cancelled");
        if (admissionErr) throw admissionErr;
        const admissionRows = (admissionCases ?? []) as AdmissionMini[];
        const residentIds = Array.from(
          new Set(
            admissionRows
              .map((row) => row.resident_id)
              .filter((value): value is string => typeof value === "string" && value.length > 0),
          ),
        );
        const [carePlansRes, medsRes, payersRes, consentsRes] =
          residentIds.length > 0
            ? await Promise.all([
                supabase.from("care_plans").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
                supabase.from("resident_medications").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
                supabase.from("resident_payers").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
                supabase.from("family_consent_records").select("resident_id").in("resident_id", residentIds).is("deleted_at", null),
              ])
            : [
                { data: [], error: null },
                { data: [], error: null },
                { data: [], error: null },
                { data: [], error: null },
              ];
        if (carePlansRes.error) throw carePlansRes.error;
        if (medsRes.error) throw medsRes.error;
        if (payersRes.error) throw payersRes.error;
        if (consentsRes.error) throw consentsRes.error;

        const carePlanIds = new Set((carePlansRes.data ?? []).map((row) => row.resident_id));
        const medIds = new Set((medsRes.data ?? []).map((row) => row.resident_id));
        const payerIds = new Set((payersRes.data ?? []).map((row) => row.resident_id));
        const consentIds = new Set((consentsRes.data ?? []).map((row) => row.resident_id));

        const activeMap = Object.fromEntries(
          admissionRows
            .filter((row) => !!row.referral_lead_id)
            .map((row) => {
              let phase: HandoffPhase = "complete";
              const blocked =
                !row.financial_clearance_at ||
                !row.physician_orders_received_at ||
                !row.bed_id ||
                !row.target_move_in_date;
              if (blocked) {
                phase = "blocked";
                handoffBlocked += 1;
              } else if (row.status !== "move_in") {
                phase = "ready";
                handoffReady += 1;
              } else {
                const onboardingMissing =
                  !carePlanIds.has(row.resident_id) ||
                  !medIds.has(row.resident_id) ||
                  !payerIds.has(row.resident_id) ||
                  !consentIds.has(row.resident_id);
                if (onboardingMissing) {
                  phase = "onboarding";
                  handoffOnboarding += 1;
                }
              }
              return [row.referral_lead_id as string, { id: row.id, phase }] as const;
            }),
        );
        setActiveAdmissionCaseByLeadId(activeMap);
        inAdmissionsCount = Object.keys(activeMap).length;
      } else {
        setActiveAdmissionCaseByLeadId({});
      }

      const base = () =>
        supabase
          .from("referral_leads")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const hl7Base = () =>
        supabase
          .from("referral_hl7_inbound")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null);

      const [cNew, cConv, cAtt, cPipe, hl7Pending, hl7Failed] = await Promise.all([
        base().eq("status", "new"),
        base().eq("status", "converted"),
        base().in("status", ["new", "contacted"]),
        supabase
          .from("referral_leads")
          .select("id", { count: "exact", head: true })
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .not("status", "in", "(converted,lost,merged)"),
        hl7Base().eq("status", "pending"),
        hl7Base().eq("status", "failed"),
      ]);

      setCounts({
        new: cNew.count ?? 0,
        pipeline: cPipe.count ?? 0,
        converted: cConv.count ?? 0,
        attention: cAtt.count ?? 0,
        inAdmissions: inAdmissionsCount,
        handoffBlocked,
        handoffReady,
        handoffOnboarding,
      });
      setHl7Counts({
        pending: hl7Pending.count ?? 0,
        failed: hl7Failed.count ?? 0,
      });
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load referrals.");
      setRows([]);
      setOutreachRows([]);
      setHl7Counts({ pending: 0, failed: 0 });
      setActiveAdmissionCaseByLeadId({});
      setCounts({ new: 0, pipeline: 0, converted: 0, attention: 0, inAdmissions: 0, handoffBlocked: 0, handoffReady: 0, handoffOnboarding: 0 });
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

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

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-12 w-full">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
         <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Module 22
           </div>
           <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Referral CRM
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400">
             Inquiries and pipeline before admission — source attribution and conversion.
           </p>
         </div>
         <div className="hidden md:block">
           <ReferralsHubNav />
         </div>
      </div>

      {noFacility ? (
        <div className="rounded-[1.5rem] border border-amber-500/20 bg-amber-500/5 p-6 text-sm text-amber-700 dark:text-amber-400 font-medium tracking-wide flex items-center gap-4 backdrop-blur-sm">
           <div className="w-10 h-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0 border border-amber-500/30">
              <span className="font-bold">!</span>
           </div>
           Select a facility in the header to load referral leads and metrics.
        </div>
      ) : null}

      {/* ─── METRIC PILLARS ─── */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4 pt-4">
        <div className="h-[180px]">
           <V2Card hoverColor="emerald" className="border-emerald-500/20 shadow-[0_8px_30px_rgba(16,185,129,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
                 New Leads
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.new}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="indigo" className="border-indigo-500/20 shadow-[0_8px_30px_rgba(99,102,241,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-indigo-600 dark:text-indigo-400 flex items-center gap-2">
                 Active Pipeline
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.pipeline}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="blue" className="border-blue-500/20 shadow-[0_8px_30px_rgba(59,130,246,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-blue-600 dark:text-blue-400 flex items-center gap-2">
                 Converted
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.converted}
               </p>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="rose" className="border-rose-500/20 shadow-[0_8px_30px_rgba(244,63,94,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-rose-600 dark:text-rose-400 flex items-center gap-2">
                 Needs Attention
               </h3>
               <div className="flex items-center gap-3">
                 <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                   {noFacility ? "—" : loading ? "—" : counts.attention}
                 </p>
               </div>
             </div>
           </V2Card>
        </div>
        <div className="h-[180px]">
           <V2Card hoverColor="amber" className="border-amber-500/20 shadow-[0_8px_30px_rgba(245,158,11,0.05)]">
             <div className="relative z-10 flex flex-col h-full justify-between pt-2 pb-1">
               <h3 className="text-xs font-bold tracking-widest uppercase text-amber-600 dark:text-amber-400 flex items-center gap-2">
                 In Admissions
               </h3>
               <p className="text-6xl font-display font-medium tracking-tight text-slate-900 dark:text-white mt-auto">
                 {noFacility ? "—" : loading ? "—" : counts.inAdmissions}
               </p>
             </div>
           </V2Card>
        </div>
      </div>

      <div className="h-[120px]">
        <V2Card href="/admin/referrals/new" hoverColor="indigo" className="border-indigo-500/20 pb-0">
          <div className="flex items-center gap-6 h-full absolute inset-0 px-8">
            <div className="rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 p-4 border border-indigo-100 dark:border-indigo-500/20">
              <UserPlus className="h-6 w-6 text-indigo-600 dark:text-indigo-400" />
            </div>
            <div>
              <h3 className="font-display text-xl lg:text-2xl font-medium tracking-tight text-slate-900 dark:text-white group-hover:text-indigo-600 dark:group-hover:text-indigo-400 transition-colors">
                New Prospect Lead
              </h3>
              <p className="text-sm text-slate-500 dark:text-zinc-400 tracking-wide mt-1">Add an inquiry directly to the chosen facility pipeline.</p>
            </div>
            <ArrowRight className="h-6 w-6 text-slate-300 dark:text-slate-700 ml-auto group-hover:text-indigo-500 transition-colors group-hover:translate-x-2 duration-300" />
          </div>
        </V2Card>
      </div>

      {!noFacility ? (
        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2rem] bg-white/50 dark:bg-black/20 shadow-sm backdrop-blur-3xl overflow-hidden p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Upcoming tours</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400 tracking-wide">
                Tour scheduling now lives on the lead record, so this queue becomes the operational source for the standup tour forecast.
              </p>
            </div>
            <Badge className="border-none bg-indigo-500/10 text-indigo-600 dark:text-indigo-300">Standup source</Badge>
          </div>

          {upcomingTours.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-zinc-400">No tours are currently scheduled in this facility pipeline.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {upcomingTours.map((row) => (
                <Link
                  key={row.id}
                  href={`/admin/referrals/${row.id}`}
                  className="rounded-xl border border-slate-200/70 dark:border-white/10 px-4 py-3 transition hover:border-indigo-300 dark:hover:border-indigo-400/40"
                >
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">{row.first_name} {row.last_name}</div>
                      <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-400">{formatStatus(row.status)}</div>
                    </div>
                    <div className="text-xs text-slate-500 dark:text-zinc-400">
                      {row.tour_scheduled_for ? new Date(row.tour_scheduled_for).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}

      {!noFacility ? (
        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2rem] bg-white/50 dark:bg-black/20 shadow-sm backdrop-blur-3xl overflow-hidden p-6">
          <div className="mb-5 flex items-start justify-between gap-4">
            <div>
              <p className="text-base font-bold text-slate-900 dark:text-white tracking-tight">Outreach & provider activity</p>
              <p className="mt-1 text-sm text-slate-600 dark:text-zinc-400 tracking-wide">
                Log the provider, facility, and event activity that should feed the weekly standup instead of typing those rows manually.
              </p>
            </div>
            <Badge className="border-none bg-emerald-500/10 text-emerald-600 dark:text-emerald-300">Standup source</Badge>
          </div>

          <div className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
            <div className="grid gap-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <select
                  className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2 text-sm"
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value)}
                >
                  <option value="provider_visit">Provider visit</option>
                  <option value="home_health_provider">Home health provider</option>
                  <option value="facility_outreach">Facility outreach</option>
                  <option value="community_event">Community event</option>
                  <option value="digital_outreach">Digital outreach</option>
                </select>
                <select
                  className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2 text-sm"
                  value={activityStatus}
                  onChange={(e) => setActivityStatus(e.target.value)}
                >
                  <option value="planned">Planned</option>
                  <option value="completed">Completed</option>
                  <option value="cancelled">Cancelled</option>
                </select>
              </div>
              <input
                type="datetime-local"
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2 text-sm"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
              />
              <input
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2 text-sm"
                placeholder="Partner / facility / event name"
                value={partnerName}
                onChange={(e) => setPartnerName(e.target.value)}
              />
              <textarea
                className="rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2 text-sm"
                rows={3}
                placeholder="Notes"
                value={activityNotes}
                onChange={(e) => setActivityNotes(e.target.value)}
              />
              <Button
                type="button"
                disabled={savingActivity}
                onClick={() => void createOutreachActivity({
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
                })}
              >
                {savingActivity ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Save activity
              </Button>
            </div>

            <div className="space-y-2">
              {outreachRows.length === 0 ? (
                <p className="text-sm text-slate-500 dark:text-zinc-400">No outreach/provider activity logged yet for this facility.</p>
              ) : (
                outreachRows.map((row) => (
                  <div key={row.id} className="rounded-xl border border-slate-200/70 dark:border-white/10 px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="font-medium text-slate-900 dark:text-white">
                          {row.external_partner_name ?? row.activity_type.replace(/_/g, " ")}
                        </div>
                        <div className="text-xs uppercase tracking-widest text-slate-500 dark:text-zinc-400">
                          {row.activity_type.replace(/_/g, " ")} · {row.status}
                        </div>
                      </div>
                      <div className="text-xs text-slate-500 dark:text-zinc-400">
                        {row.scheduled_for ? new Date(row.scheduled_for).toLocaleString() : row.performed_for_week ?? "—"}
                      </div>
                    </div>
                    {row.notes ? <p className="mt-2 text-sm text-slate-600 dark:text-zinc-300">{row.notes}</p> : null}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <select
                        className="rounded-lg border border-slate-200 dark:border-white/10 bg-white dark:bg-black/20 px-3 py-2 text-xs uppercase tracking-widest"
                        value={outreachStatusDrafts[row.id] ?? row.status}
                        onChange={(e) => setOutreachStatusDrafts((current) => ({ ...current, [row.id]: e.target.value }))}
                      >
                        <option value="planned">Planned</option>
                        <option value="completed">Completed</option>
                        <option value="cancelled">Cancelled</option>
                      </select>
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
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      ) : null}

      {!noFacility ? (
        <div className="glass-panel border-amber-200/60 dark:border-amber-500/20 rounded-[2rem] bg-amber-50/50 dark:bg-amber-950/20 shadow-sm backdrop-blur-3xl overflow-hidden p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-base font-bold text-slate-900 dark:text-white mb-1 tracking-tight">Admissions Handoff</p>
            <p className="text-sm text-slate-600 dark:text-zinc-400 tracking-wide">
              {loading
                ? "Loading handoff counts…"
                : `${counts.inAdmissions} referral lead${counts.inAdmissions === 1 ? "" : "s"} already have an active admission case in this facility.`}
            </p>
            {!loading && counts.inAdmissions > 0 ? (
              <p className="text-xs text-slate-600 dark:text-zinc-400 tracking-wide mt-1">
                {counts.handoffBlocked} blocked · {counts.handoffReady} ready · {counts.handoffOnboarding} onboarding
              </p>
            ) : null}
          </div>
          <Link
            href="/admin/referrals/in-admissions"
            className={cn(buttonVariants({ variant: "outline" }), "shrink-0 shadow-sm rounded-full bg-white dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 w-full sm:w-auto px-6 tap-responsive font-bold uppercase tracking-widest text-xs")}
          >
            Open Handoff Queue
          </Link>
        </div>
      ) : null}

      {!noFacility ? (
        <div className="glass-panel border-amber-200/60 dark:border-amber-500/20 rounded-[2rem] bg-amber-50/50 dark:bg-amber-950/20 shadow-sm backdrop-blur-3xl overflow-hidden p-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div>
            <p className="text-base font-bold text-slate-900 dark:text-white mb-1 tracking-tight">HL7 ADT Inbound Queue</p>
            <p className="text-sm text-slate-600 dark:text-zinc-400 tracking-wide">
              {loading
                ? "Loading queue counts…"
                : `Pending ${hl7Counts.pending} · Failed ${hl7Counts.failed} for this facility. Open the queue for processed and ignored messages.`}
            </p>
          </div>
          <Link
            href="/admin/referrals/hl7-inbound"
            className={cn(buttonVariants({ variant: "outline" }), "shrink-0 shadow-sm rounded-full bg-white dark:bg-black/50 border-slate-200 dark:border-white/10 text-slate-900 dark:text-white hover:bg-slate-50 dark:hover:bg-white/5 w-full sm:w-auto px-6 tap-responsive font-bold uppercase tracking-widest text-xs")}
          >
            Review Pipeline
          </Link>
        </div>
      ) : null}

      {/* ─── CASE ROSTER (GLASS ROWS) ─── */}
      <div className="space-y-6">
        <div className="flex flex-col gap-3 border-b border-slate-200/50 dark:border-white/10 pb-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <ClipboardList className="h-5 w-5 text-indigo-500" />
              <h3 className="text-xl font-display font-medium text-slate-900 dark:text-white tracking-tight">
                Pipeline Leads
              </h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={noFacility || exportingCsv}
              className="h-10 shrink-0 gap-2 rounded-full text-[10px] font-bold uppercase tracking-widest sm:self-start"
              title={
                (statusFilter === "all"
                  ? "Export up to 500 leads (all statuses), most recently updated first."
                  : `Export up to 500 ${statusFilter.replace(/_/g, " ")} leads, most recently updated first.`) +
                " Search does not narrow the CSV."
              }
              onClick={() => void exportReferralLeadsCsv()}
            >
              <Download className="h-4 w-4" aria-hidden />
              {exportingCsv ? "Preparing…" : "Download leads CSV"}
            </Button>
          </div>
          {!noFacility ? (
            <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
              <label className="flex min-w-0 max-w-full flex-1 items-center gap-2 sm:max-w-md">
                <Search className="h-4 w-4 shrink-0 text-slate-400" aria-hidden />
                <Input
                  type="search"
                  placeholder="Search name, phone, email, source, external ref…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-9 rounded-lg border-slate-200 bg-white text-sm dark:border-white/10 dark:bg-white/5"
                  aria-label="Filter pipeline by text"
                />
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-400">
                <span className="text-[10px] font-mono uppercase tracking-widest text-slate-400">Status</span>
                <select
                  className={cn(
                    "h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-900 outline-none dark:border-white/10 dark:bg-white/5 dark:text-slate-100",
                    "focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50",
                  )}
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as "all" | ReferralLeadStatus)}
                >
                  {LEAD_STATUS_FILTERS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </label>
              {rows.length > 0 ? (
                <p className="text-[10px] font-mono tracking-widest text-slate-400 uppercase">
                  {searchQuery.trim() ? (
                    <>
                      Showing {featuredRows.length} of {displayRows.length} · Search
                    </>
                  ) : (
                    <>
                      Showing {featuredRows.length} of {rows.length} · Priority-ranked
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

        <div className="glass-panel border-slate-200/60 dark:border-white/5 rounded-[2.5rem] bg-white/60 dark:bg-white/[0.015] shadow-2xl backdrop-blur-3xl overflow-hidden p-6 md:p-8 relative">
           <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/10 rounded-full blur-[80px] -mr-16 -mt-16 pointer-events-none" />

           <div className="hidden lg:grid grid-cols-[2fr_1fr_1fr_1fr] gap-4 px-6 pb-4 border-b border-slate-200 dark:border-white/5 relative z-10">
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Lead Name</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500">Status</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Source</div>
             <div className="text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 text-right">Updated</div>
           </div>

           <div className="space-y-4 mt-6 relative z-10">
             {noFacility ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Select a facility to view leads.
               </div>
             ) : loading ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500">
                 Loading pipeline...
               </div>
             ) : rows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No leads yet. Starts with <strong>New lead</strong>.
               </div>
             ) : filteredRows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No leads match this status filter.
               </div>
             ) : displayRows.length === 0 ? (
               <div className="p-8 text-center text-sm font-medium text-slate-500 dark:text-zinc-500 bg-slate-50 dark:bg-black/40 rounded-[1.5rem] border border-dashed border-slate-200 dark:border-white/10">
                 No leads match this search.
               </div>
             ) : (
                <MotionList className="space-y-4">
                 {featuredRows.map((r) => {
                    const isNew = r.status.includes('new');
                    const linkedAdmission = activeAdmissionCaseByLeadId[r.id] ?? null;
                    const linkedAdmissionCaseId = linkedAdmission?.id ?? null;
                    const handoffPhase = linkedAdmission?.phase ?? null;
                    
                    return (
                      <MotionItem key={r.id}>
                        <Link
                          href={`/admin/referrals/${r.id}`}
                          className="grid grid-cols-1 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-4 items-center p-6 rounded-[1.8rem] bg-white dark:bg-white/[0.03] border border-slate-100 dark:border-white/5 shadow-sm tap-responsive group hover:border-indigo-200 dark:hover:border-indigo-500/30 transition-all duration-300 w-full cursor-pointer outline-none hover:shadow-lg dark:hover:bg-white/[0.05]"
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-slate-100 dark:bg-black/60 border border-slate-200 dark:border-white/10 flex items-center justify-center shrink-0">
                              {isNew ? <PulseDot colorClass="bg-emerald-500" /> : <div className="w-2 h-2 rounded-full bg-indigo-500" />}
                            </div>
                            <span className="font-semibold text-xl text-slate-900 dark:text-white truncate group-hover:text-indigo-600 dark:group-hover:text-indigo-300 transition-colors tracking-tight font-display">
                               {r.first_name} {r.last_name}
                            </span>
                          </div>
                          
                          <div className="flex flex-row justify-between lg:justify-start items-center">
                            <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Status</span>
                            <div className="flex items-center gap-2">
                              <span className={cn(
                                "text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner",
                                isNew ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/20 dark:text-emerald-400" : "bg-slate-500/10 text-slate-600 border-slate-500/20 dark:text-slate-400"
                              )}>
                                {formatStatus(r.status)}
                              </span>
                              {linkedAdmissionCaseId ? (
                                <span className="text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                                  In admissions
                                </span>
                              ) : null}
                              {handoffPhase === "blocked" ? (
                                <span className="text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner bg-amber-500/10 text-amber-700 border-amber-500/20 dark:text-amber-300">
                                  Blocked
                                </span>
                              ) : handoffPhase === "ready" ? (
                                <span className="text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner bg-emerald-500/10 text-emerald-700 border-emerald-500/20 dark:text-emerald-300">
                                  Ready
                                </span>
                              ) : handoffPhase === "onboarding" ? (
                                <span className="text-[10px] uppercase font-bold tracking-widest px-3 py-1.5 rounded-full border shadow-inner bg-indigo-500/10 text-indigo-700 border-indigo-500/20 dark:text-indigo-300">
                                  Onboarding
                                </span>
                              ) : null}
                            </div>
                          </div>
                          
                          <div className="flex flex-row justify-between lg:justify-end items-center">
                            <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Source</span>
                            <span className="text-sm font-medium text-slate-700 dark:text-zinc-300 truncate">
                              {r.referral_sources?.name ?? "—"}
                            </span>
                          </div>

                          <div className="flex flex-row justify-between lg:justify-end items-center">
                            <span className="lg:hidden text-xs text-slate-500 uppercase tracking-widest font-bold">Updated</span>
                          <div className="flex flex-col items-end">
                            <span className="text-[11px] font-mono tracking-wide text-slate-500 dark:text-zinc-500">
                              {new Date(r.updated_at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                            </span>
                            {r.tour_scheduled_for ? (
                              <span className="text-[11px] text-indigo-700 dark:text-indigo-300">
                                Tour {new Date(r.tour_scheduled_for).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}
                              </span>
                            ) : null}
                            {linkedAdmissionCaseId ? (
                              <span className="text-[11px] text-amber-700 dark:text-amber-300">
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
                      </MotionItem>
                    )
                  })}
                </MotionList>
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

    const weekStart = new Date(scheduledFor || new Date().toISOString());
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
        scheduled_for: scheduledFor ? new Date(scheduledFor).toISOString() : null,
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
