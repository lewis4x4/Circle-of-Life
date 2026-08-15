"use client";

import { useState } from "react";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveNavV2 } from "@/components/executive/executive-nav-v2";
import {
  HavenInsightPanel,
  OfficerAlertsPanel,
  OfficerEmptyTab,
  OfficerHeader,
  OfficerKpiStrip,
  OfficerKpiTile,
  OfficerLanes,
  OfficerLinkOutPanel,
  officerAlarmTone,
  useFacilityNameMap,
  type OfficerLane,
} from "@/components/executive/officer-dashboard";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  formatExecutiveArOutstandingCents,
  formatExecutiveCertsExpiringCount,
  formatExecutiveOccupancyPctWithSuffix,
  formatExecutiveOpenInvoiceCount,
} from "@/lib/executive/executive-display-copy";

const CFO_TABS = [
  "Overview",
  "Revenue Cycle",
  "Labor Economics",
  "Cash & Liquidity",
  "Capex & Debt",
  "Budget Variance",
  "Scenarios",
  "Haven Insight",
];

const TAB_DOMAIN: Record<string, string> = {
  "Revenue Cycle": "resident billing, payer mix, and AR aging",
  "Labor Economics": "payroll, agency, and overtime economics",
  "Cash & Liquidity": "cash, collections, and payments",
  "Capex & Debt": "capex projects and the debt schedule",
  "Budget Variance": "budget-vs-actual ledger",
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function CfoDashboardPage() {
  const [tab, setTab] = useState("Overview");
  const { selectedFacilityId } = useFacilityStore();
  const { kpis, alerts, facilities, loading, error, refetch } = useExecRoleKpis(selectedFacilityId);
  const facilityNameById = useFacilityNameMap(facilities);

  const scopeLabel = selectedFacilityId
    ? facilityNameById.get(selectedFacilityId) ?? "the selected facility"
    : "all facilities";

  const arCents = kpis?.financial.totalBalanceDueCents;
  const occupancyPct = kpis?.census.occupancyPct;
  const openInvoices = kpis?.financial.openInvoicesCount;
  const certsExpiring = kpis?.workforce.certificationsExpiring30d;

  const arValue = loading ? "…" : formatExecutiveArOutstandingCents(arCents);
  const occValue = loading ? "…" : formatExecutiveOccupancyPctWithSuffix(occupancyPct);
  const invoicesValue = loading ? "…" : formatExecutiveOpenInvoiceCount(openInvoices);
  const certsValue = loading ? "…" : formatExecutiveCertsExpiringCount(certsExpiring);

  const lanes: OfficerLane[] = [
    {
      stat: openInvoices == null ? formatExecutiveOpenInvoiceCount(null) : `${openInvoices} open invoices`,
      title: "Finance hub",
      description: "Billed revenue, labor pressure, and monthly financials.",
      href: "/admin/finance",
    },
    {
      stat: arCents == null ? formatExecutiveArOutstandingCents(null) : `${money.format(arCents / 100)} outstanding`,
      title: "AR & collections",
      description: "Aging, payer mix, and collections workflow.",
      href: "/admin/billing/ar-aging",
    },
    {
      stat: "Claims & COI",
      title: "Insurance & risk",
      description: "Policies, renewals, and portfolio risk posture.",
      href: "/admin/insurance",
    },
    {
      stat: "What-if model",
      title: "Scenarios",
      description: "Occupancy, rate, and labor projections.",
      href: "/admin/executive/scenarios",
    },
  ];

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full">
      <div className="border-b border-border">
        <ExecutiveNavV2
          showTopNav={false}
          activeTopNav="finance"
          activePillMenu={tab}
          onPillMenuChange={setTab}
          customPillTabs={CFO_TABS}
        />
      </div>

      <OfficerHeader
        title="Chief Financial Officer"
        subtitle={`Live finance command center — ${scopeLabel}.`}
      />

      <div className="flex flex-col gap-6 px-6 py-8 sm:px-12">
        {error ? <AdminLiveDataFallbackNotice message={error} onRetry={refetch} /> : null}

        <OfficerKpiStrip>
          <OfficerKpiTile label="Total AR outstanding" value={arValue} />
          <OfficerKpiTile label="Portfolio occupancy" value={occValue} />
          <OfficerKpiTile label="Open invoices" value={invoicesValue} />
          <OfficerKpiTile label="Certs expiring 30d" value={certsValue} tone={officerAlarmTone(certsExpiring, "warning")} />
        </OfficerKpiStrip>

        {tab === "Overview" ? (
          <>
            <OfficerLanes lanes={lanes} subheading="Jump into the live finance queues." />
            <OfficerAlertsPanel
              heading="Finance & risk alerts"
              emptyTitle="No open finance alerts"
              emptyDescription="Finance and risk exceptions across your facilities will appear here as they trigger."
              alerts={alerts}
              facilityNameById={facilityNameById}
              loading={loading}
              error={error}
              onRetry={refetch}
            />
          </>
        ) : tab === "Scenarios" ? (
          <OfficerLinkOutPanel
            title="Scenario planner"
            description="The full what-if forecasting engine — occupancy, rate, labor, and debt-service assumptions with revenue / NOI / cash-flow projections."
            href="/admin/executive/scenarios"
            cta="Open scenario planner"
          />
        ) : tab === "Haven Insight" ? (
          <HavenInsightPanel domain="finance" />
        ) : (
          <OfficerEmptyTab tab={tab} domain={TAB_DOMAIN[tab] ?? "finance"} />
        )}
      </div>
    </div>
  );
}
