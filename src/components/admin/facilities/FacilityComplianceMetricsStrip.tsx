"use client";

import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import type { FacilityDetailRow } from "@/types/facility";
import { StatusPill } from "@/components/ui/status-pill";
import { SurveyRecencyKpiTile } from "@/components/admin/facilities/SurveyRecencyKpiTile";
import {
  deriveLicenseStanding,
  licenseStandingLabel,
  licenseStandingTone,
  renewalCountdownAccentClass,
  daysBetweenTodayAndRenewal,
  ahcaExpiryYmd,
} from "@/lib/admin/facilities/license-record-metrics";
import {
  complianceStripDaysToRenewalIsMissing,
  formatComplianceStripDaysToRenewal,
  formatComplianceStripRenewalLead,
} from "@/lib/facilities/licensing-tab-display-copy";

interface FacilityComplianceMetricsStripProps {
  facility: FacilityDetailRow;
}

export function FacilityComplianceMetricsStrip({ facility }: FacilityComplianceMetricsStripProps) {
  const licenseNumPresent = !!(facility.ahca_license_number ?? facility.license_number)?.toString?.().trim();
  const expiryYmd = ahcaExpiryYmd(facility as unknown as Record<string, unknown>);
  const daysRenew = daysBetweenTodayAndRenewal(expiryYmd);
  const standing = deriveLicenseStanding({
    licenseNumberPresent: !!licenseNumPresent,
    expiryIso: expiryYmd,
    lastSurveyResult: facility.last_survey_result,
    facilityStatus: typeof facility.status === "string" ? facility.status : null,
  });
  const openCitations =
    typeof facility.open_survey_deficiencies_count === "number" &&
    Number.isFinite(facility.open_survey_deficiencies_count)
      ? Math.max(0, Math.round(facility.open_survey_deficiencies_count))
      : 0;

  const renewalLead = formatComplianceStripRenewalLead(daysRenew);
  const daysRenewLabel = formatComplianceStripDaysToRenewal(daysRenew);
  const daysRenewMissing = complianceStripDaysToRenewalIsMissing(daysRenew);

  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">License status</p>
        <div className="mt-3">
          <StatusPill tone={licenseStandingTone(standing)}>{licenseStandingLabel(standing)}</StatusPill>
        </div>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Days to renewal</p>
        <p
          className={cn(
            "mt-2 font-semibold tabular-nums",
            daysRenewMissing ? "text-lg leading-snug text-muted-foreground" : "text-3xl",
            !daysRenewMissing && renewalCountdownAccentClass(daysRenew),
          )}
        >
          {daysRenewLabel}
        </p>
        <p className="mt-1 text-[12px] text-muted-foreground">{renewalLead}</p>
      </div>

      <div className="rounded-[8px] border border-border bg-muted/10 p-5">
        <p className="text-[13px] text-muted-foreground">Open citations</p>
        <p className="mt-2 text-3xl font-semibold tabular-nums text-foreground">{openCitations}</p>
        <p className="mt-1 text-[12px] text-muted-foreground">
          <Link href="/admin/compliance" className="text-primary hover:underline">
            View compliance dashboard
          </Link>
        </p>
      </div>

      <SurveyRecencyKpiTile lastSurveyDate={facility.last_survey_date ?? null} />
    </div>
  );
}
