"use client";

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ArrowLeft, Brain } from "lucide-react";

import {
  AdminEmptyState,
  AdminLiveDataFallbackNotice,
  AdminOperationalListPanel,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import { KpiCard, type KpiCardTone } from "@/components/ui/kpi-card";
import { StatusPill, type StatusPillTone } from "@/components/ui/status-pill";
import { buttonVariants } from "@/components/ui/button";
import { TitleH1, Subtitle } from "@/components/ui/typography";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import type { ExecutiveAlertRow } from "@/lib/exec-alerts";
import { cn } from "@/lib/utils";

const COO_TABS = [
  "Operations Hub",
  "Staffing",
  "Maintenance",
  "Dining",
  "Satisfaction",
  "Move Ops",
  "Vendors",
  "Readiness",
  "Haven Insight",
];

/** What each not-yet-wired tab will surface — drives an honest empty state. */
const TAB_DOMAIN: Record<string, string> = {
  Staffing: "staffing ratios, shift coverage, and credential expirations",
  Maintenance: "work orders and preventive maintenance",
  Dining: "diet orders, meal service, and refusals",
  Satisfaction: "reputation reviews and family satisfaction",
  "Move Ops": "the admissions pipeline and move-in / move-out operations",
  Vendors: "vendor contracts, insurance compliance, and spend",
  Readiness: "survey readiness and emergency preparedness",
};

function severityTone(severity: string): StatusPillTone {
  if (severity === "critical") return "danger";
  if (severity === "warning") return "warning";
  return "info";
}

function countTone(value: number | undefined, tone: KpiCardTone): KpiCardTone {
  return value != null && value > 0 ? tone : "neutral";
}

function relativeAge(iso: string | null): string {
  if (!iso) return "—";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "—";
  const mins = Math.max(0, Math.round((Date.now() - then) / 60000));
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function OperationalAlertsPanel({
  alerts,
  facilityNameById,
  loading,
  error,
  onRetry,
}: {
  alerts: ExecutiveAlertRow[];
  facilityNameById: Map<string, string>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
          <AlertTriangle className="size-4 text-warning" aria-hidden /> Operational alerts
        </h2>
        {!loading && !error ? (
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {alerts.length} {alerts.length === 1 ? "open" : "open"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <AdminTableLoadingState />
      ) : error ? (
        <AdminLiveDataFallbackNotice message={error} onRetry={onRetry} />
      ) : alerts.length === 0 ? (
        <AdminEmptyState
          title="No open operational alerts"
          description="Escalations and exception alerts across your facilities will appear here as they trigger."
        />
      ) : (
        <AdminOperationalListPanel>
          <div className="divide-y divide-border">
            {alerts.map((alert) => {
              const facilityName = alert.facility_id
                ? facilityNameById.get(alert.facility_id) ?? "Facility"
                : "Enterprise";
              return (
                <div key={alert.id} className="flex items-start gap-3 px-4 py-3">
                  <StatusPill tone={severityTone(alert.severity)} className="mt-0.5 shrink-0">
                    {alert.severity}
                  </StatusPill>
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-foreground">{alert.title}</p>
                    {alert.body ? (
                      <p className="mt-0.5 text-[12px] leading-relaxed text-muted-foreground">{alert.body}</p>
                    ) : null}
                    <p className="mt-1 text-[11px] text-muted-foreground">
                      {alert.category ?? "operations"} · {facilityName} ·{" "}
                      {relativeAge(alert.first_triggered_at ?? alert.created_at)}
                    </p>
                  </div>
                  {alert.deep_link_path ? (
                    <Link
                      prefetch={false}
                      href={alert.deep_link_path}
                      className="shrink-0 text-[12px] font-medium text-foreground underline-offset-4 hover:underline"
                    >
                      Open
                    </Link>
                  ) : null}
                </div>
              );
            })}
          </div>
        </AdminOperationalListPanel>
      )}
    </section>
  );
}

function HavenInsightPanel() {
  return (
    <AdminOperationalListPanel>
      <div className="flex flex-col items-start gap-3 px-4 py-6">
        <h2 className="inline-flex items-center gap-2 text-[14px] font-semibold tracking-tight text-foreground">
          <Brain className="size-4 text-muted-foreground" aria-hidden /> Haven Insight
        </h2>
        <p className="max-w-md text-[13px] leading-relaxed text-muted-foreground">
          Ask questions about live operations data in natural language.
        </p>
        <Link
          prefetch={false}
          href="/admin/executive/nlq"
          className={cn(buttonVariants({ size: "sm" }), "gap-1.5")}
        >
          <Brain className="size-4" aria-hidden /> Open Haven Insight
        </Link>
      </div>
    </AdminOperationalListPanel>
  );
}

function TabBody({
  tab,
  alerts,
  facilityNameById,
  loading,
  error,
  onRetry,
}: {
  tab: string;
  alerts: ExecutiveAlertRow[];
  facilityNameById: Map<string, string>;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}): ReactNode {
  if (tab === "Operations Hub") {
    return (
      <OperationalAlertsPanel
        alerts={alerts}
        facilityNameById={facilityNameById}
        loading={loading}
        error={error}
        onRetry={onRetry}
      />
    );
  }
  if (tab === "Haven Insight") {
    return <HavenInsightPanel />;
  }
  return (
    <AdminEmptyState
      title={`${tab} — wiring in progress`}
      description={`This tab will surface live ${TAB_DOMAIN[tab] ?? "operations"} data, scoped to your selected facility. Building it out now.`}
    />
  );
}

export default function CooDashboardPage() {
  const [tab, setTab] = useState("Operations Hub");
  const { selectedFacilityId } = useFacilityStore();
  const { kpis, alerts, facilities, loading, error, refetch } = useExecRoleKpis(selectedFacilityId);

  const facilityNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const facility of facilities) map.set(facility.id, facility.name);
    return map;
  }, [facilities]);

  const scopeLabel = selectedFacilityId
    ? facilityNameById.get(selectedFacilityId) ?? "the selected facility"
    : "all facilities";

  const openIncidents = kpis?.clinical.openIncidents;
  const medErrors = kpis?.clinical.medicationErrorsMtd;
  const outbreaks = kpis?.infection.activeOutbreaks;
  const overdue = kpis?.residentAssurance.overdueTasksCount;
  const kpiValue = (value: number | undefined): string => (loading ? "…" : value == null ? "—" : String(value));

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <div className="border-b border-border">
        <ExecutiveNavV2
          showTopNav={false}
          activeTopNav="clinical"
          activePillMenu={tab}
          onPillMenuChange={setTab}
          customPillTabs={COO_TABS}
        />
      </div>

      <header className="px-6 py-8 sm:px-12">
        <div className="flex flex-col gap-1 border-b border-border pb-6">
          <Link
            href="/admin/executive"
            className="mb-2 inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to Executive Overview
          </Link>
          <TitleH1>Chief Operating Officer</TitleH1>
          <Subtitle>Live operations command center — {scopeLabel}.</Subtitle>
        </div>
      </header>

      <div className="flex flex-col gap-6 px-6 pb-12 sm:px-12">
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={refetch} /> : null}

        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <KpiCard value={kpiValue(openIncidents)} label="Open incidents" tone={countTone(openIncidents, "danger")} />
          <KpiCard value={kpiValue(medErrors)} label="Med errors (MTD)" tone={countTone(medErrors, "warning")} />
          <KpiCard value={kpiValue(outbreaks)} label="Active outbreaks" tone={countTone(outbreaks, "danger")} />
          <KpiCard value={kpiValue(overdue)} label="Overdue tasks" tone={countTone(overdue, "warning")} />
        </div>

        <TabBody
          tab={tab}
          alerts={alerts}
          facilityNameById={facilityNameById}
          loading={loading}
          error={error}
          onRetry={refetch}
        />
      </div>
    </div>
  );
}
