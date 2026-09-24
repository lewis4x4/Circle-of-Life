"use client";

import { AdminLiveDataFallbackNotice } from "@/components/common/admin-list-patterns";
import { ExecutiveHubNav } from "@/app/(admin)/executive/executive-hub-nav";
import { Card, CardContent } from "@/components/ui/card";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import {
  resolveExecutiveFetchErrorBannerMessage,
  resolveExecutiveOrganizationGapMessage,
} from "@/lib/executive/executive-auth-page-state";
import {
  OfficerAlertsPanel,
  OfficerHeader,
  OfficerKpiStrip,
  OfficerKpiTile,
  OfficerLanes,
  officerAlarmTone,
  useFacilityNameMap,
  type OfficerLane,
} from "@/components/executive/officer-dashboard";
import { useExecRoleKpis } from "@/hooks/useExecRoleKpis";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  EXECUTIVE_AR_TILE_LABEL,
  EXECUTIVE_OPEN_INVOICES_TILE_LABEL,
  executiveArDraftsCaption,
  formatExecutiveArOutstandingCents,
  formatExecutiveCertsExpiringCount,
  formatExecutiveOccupancyPctWithSuffix,
  formatExecutiveOpenInvoiceCount,
  executivePortfolioOccupancyFootnote,
  resolveOfficerOccupancyTileLabel,
} from "@/lib/executive/executive-display-copy";

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

export default function CfoDashboardPage() {
  const { organizationId, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId } = useFacilityStore();
  const { kpis, alerts, facilities, loading, error, refetch } = useExecRoleKpis(selectedFacilityId);
  const facilityNameById = useFacilityNameMap(facilities);

  const facilityName = selectedFacilityId
    ? facilityNameById.get(selectedFacilityId) ?? null
    : null;
  const subtitle = selectedFacilityId
    ? facilityName
      ? `This facility — CFO finance board for ${facilityName}, not a portfolio roll-up.`
      : "This facility — CFO finance board (facility name not loaded), not a portfolio roll-up."
    : "CFO finance board — all facilities in your organization.";

  const organizationGapMessage = resolveExecutiveOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: kpis != null,
  });
  const fetchErrorBannerMessage = resolveExecutiveFetchErrorBannerMessage({
    authLoading,
    fetchError: error,
  });

  const facilityScoped = Boolean(selectedFacilityId);
  const arCents = kpis?.financial.totalBalanceDueCents;
  const occupancyPct = kpis?.census.occupancyPct;
  const occupancyScope = kpis?.census.occupancyScope;
  const openInvoices = kpis?.financial.openInvoicesCount;
  const certsExpiring = kpis?.workforce.certificationsExpiring30d;

  const arValue = loading ? "…" : formatExecutiveArOutstandingCents(arCents);
  const occupancyLabel = resolveOfficerOccupancyTileLabel(facilityScoped, occupancyScope);
  const occValue = loading ? "…" : formatExecutiveOccupancyPctWithSuffix(occupancyPct);
  const occupancyFootnote = executivePortfolioOccupancyFootnote(occupancyScope);
  const invoicesValue = loading ? "…" : formatExecutiveOpenInvoiceCount(openInvoices);
  const certsValue = loading ? "…" : formatExecutiveCertsExpiringCount(certsExpiring);
  const draftsCaption = loading ? null : executiveArDraftsCaption(kpis?.financial);

  const lanes: OfficerLane[] = [
    {
      stat: openInvoices == null ? formatExecutiveOpenInvoiceCount(null) : `${openInvoices} open sent invoices`,
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
    <div className="relative w-full">
      <div className="border-b border-border px-6 py-3 sm:px-12">
        <ExecutiveHubNav />
      </div>

      <OfficerHeader title="Chief Financial Officer" subtitle={subtitle} />

      <div className="flex flex-col gap-6 px-6 py-8 sm:px-12">
        {organizationGapMessage ? (
          <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
            <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
          </Card>
        ) : null}

        {fetchErrorBannerMessage ? (
          <AdminLiveDataFallbackNotice message={fetchErrorBannerMessage} onRetry={refetch} />
        ) : null}

        <div className="flex flex-col gap-2">
          <OfficerKpiStrip>
            <OfficerKpiTile label={EXECUTIVE_AR_TILE_LABEL} value={arValue} caption={draftsCaption} />
            <OfficerKpiTile label={occupancyLabel} value={occValue} />
            <OfficerKpiTile label={EXECUTIVE_OPEN_INVOICES_TILE_LABEL} value={invoicesValue} />
            <OfficerKpiTile label="Certs expiring 30d" value={certsValue} tone={officerAlarmTone(certsExpiring, "warning")} />
          </OfficerKpiStrip>
          {occupancyFootnote ? (
            <p className="text-[12px] leading-relaxed text-muted-foreground">{occupancyFootnote}</p>
          ) : null}
        </div>

        <OfficerLanes lanes={lanes} subheading="Jump into the live finance queues." />
        <OfficerAlertsPanel
          heading="Finance & risk alerts"
          emptyTitle="No open finance alerts"
          emptyDescription="Finance and risk exceptions across your facilities will appear here as they trigger."
          alerts={alerts}
          facilityNameById={facilityNameById}
          loading={loading}
          error={fetchErrorBannerMessage}
          onRetry={refetch}
        />
      </div>
    </div>
  );
}
