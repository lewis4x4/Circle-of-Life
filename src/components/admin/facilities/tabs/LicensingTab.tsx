"use client";

import React, { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { addYears, format, isValid, parseISO } from "date-fns";
import { Loader2, Shield } from "lucide-react";
import { toast } from "sonner";

import { useFacility } from "@/hooks/useFacility";
import { useFacilitySurveys } from "@/hooks/useFacilitySurveys";
import type { SurveyRow } from "@/hooks/useFacilitySurveys";
import {
  CARE_LICENSE_SCOPE,
  CARE_SERVICE_ADDONS,
  CARE_SERVICE_LABELS,
  surveyResultDisplayLabel,
  surveyTypeDisplayLabel,
} from "@/lib/admin/facilities/facility-constants";
import type { CareLicenseScope, CareServiceAddon } from "@/lib/admin/facilities/facility-constants";
import { defaultAssistedLivingAuthorityLabel } from "@/lib/admin/facilities/license-authority";
import {
  ahcaExpiryYmd,
  daysBetweenTodayAndRenewal,
  deriveLicenseStanding,
  licenseStandingLabel,
} from "@/lib/admin/facilities/license-record-metrics";
import { RecordDetailSection } from "@/design-system/components/record-detail";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  buildCareServicesPayload,
  parseCareServicesArray,
} from "@/lib/admin/facilities/care-services-model";
import type { FacilityDetailRow } from "@/types/facility";
import {
  formatLicensingTabCitationCount,
  formatLicensingTabExpirationCaption,
  formatLicensingTabExpirationDate,
  formatLicensingTabLastEditedLabel,
  formatLicensingTabLicenseNumber,
  formatLicensingTabNextDueDate,
  formatLicensingTabPlanOfCorrectionStatus,
  formatLicensingTabSurveyDateLabel,
  formatLicensingTabYmdDate,
  LICENSING_TAB_NO_SURVEY_DATE_POSTED_COPY,
  licensingTabCitationCountHasLink,
} from "@/lib/facilities/licensing-tab-display-copy";

interface LicensingTabProps {
  facilityId: string;
}

function PendingBadge() {
  return (
    <Badge variant="secondary" className="ml-2">
      Pending
    </Badge>
  );
}

function detailLabel(text: string) {
  return <p className="text-[13px] font-medium text-muted-foreground">{text}</p>;
}

function approximateNextAnnualSurveyIso(surveyDateYmd: string): string | null {
  try {
    const d = parseISO(`${surveyDateYmd}T12:00:00.000Z`);
    if (!isValid(d)) return null;
    return format(addYears(d, 1), "yyyy-MM-dd");
  } catch {
    return null;
  }
}

function parseAlfScopeFromDb(raw: FacilityDetailRow): CareLicenseScope {
  const alf = typeof raw.alf_license_type === "string" ? raw.alf_license_type.trim() : "";
  if (
    alf === "standard_alf" ||
    alf === "enhanced_alf_services" ||
    alf === "limited_mental_health" ||
    alf === "limited_nursing"
  ) {
    return alf;
  }
  return "standard_alf";
}

function snapshotCareServices(facility: FacilityDetailRow): {
  scopeKey: CareLicenseScope;
  addonKeys: CareServiceAddon[];
  payloadSerialized: string;
} {
  const parsed = parseCareServicesArray(facility.care_services_offered ?? null, facility.alf_license_type);
  const alfFallback = parseAlfScopeFromDb(facility);
  const scope = parsed.scopeKey ?? alfFallback;
  const addons = [...parsed.addonKeys].sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
  const payload = buildCareServicesPayload(scope, addons);
  return { scopeKey: scope, addonKeys: addons, payloadSerialized: JSON.stringify(payload) };
}

type LicensingTabBodyProps = {
  facilityId: string;
  facility: FacilityDetailRow;
  surveys: SurveyRow[];
  surveysLoading: boolean;
  isUpdating: boolean;
  updateFacility: ReturnType<typeof useFacility>["updateFacility"];
};

function LicensingTabBody({
  facilityId,
  facility,
  surveys,
  surveysLoading,
  isUpdating,
  updateFacility,
}: LicensingTabBodyProps) {
  const router = useRouter();
  const careSnapshot = snapshotCareServices(facility);

  const [scopeKey, setScopeKey] = useState<CareLicenseScope>(careSnapshot.scopeKey);
  const [addonKeys, setAddonKeys] = useState<CareServiceAddon[]>(careSnapshot.addonKeys);

  const baselineSerialized = useRef<string>(careSnapshot.payloadSerialized);
  const saveTimerRef = useRef<number | null>(null);
  const scopeKeyRef = useRef<CareLicenseScope>(careSnapshot.scopeKey);
  const addonKeysRef = useRef<CareServiceAddon[]>(careSnapshot.addonKeys);

  useEffect(() => {
    scopeKeyRef.current = scopeKey;
  }, [scopeKey]);

  useEffect(() => {
    addonKeysRef.current = addonKeys;
  }, [addonKeys]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    };
  }, []);

  function scheduleCareSave() {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      saveTimerRef.current = null;
      void (async () => {
        const s = scopeKeyRef.current;
        const addons = addonKeysRef.current;
        const payload = buildCareServicesPayload(s, addons);
        if (JSON.stringify(payload) === baselineSerialized.current) return;

        const next = payload as FacilityDetailRow["care_services_offered"];
        const saved = await updateFacility({
          care_services_offered: next,
          alf_license_type: s,
        });

        if (saved) {
          toast.success("Care pathway saved.");
        }
      })().catch(() => toast.error("Could not save care services."));
    }, 520);
  }

  const tz =
    typeof facility.timezone === "string" && facility.timezone.trim() !== ""
      ? facility.timezone.trim()
      : "America/New_York";

  const licenseNum = facility.ahca_license_number ?? facility.license_number;
  const licenseNumberPresent = !!(licenseNum && String(licenseNum).trim() !== "");
  const licensePending = !licenseNumberPresent;
  const authorityLabel =
    (typeof facility.license_authority === "string" && facility.license_authority.trim() !== ""
      ? facility.license_authority.trim()
      : null) ?? defaultAssistedLivingAuthorityLabel(facility.state);

  const expiryYmd = ahcaExpiryYmd(facility as unknown as Record<string, unknown>);
  const daysToExpiry = daysBetweenTodayAndRenewal(expiryYmd);
  const openingYmd =
    typeof (facility as { opening_date?: string | null }).opening_date === "string"
      ? (facility as { opening_date?: string | null }).opening_date
      : null;

  const standing = deriveLicenseStanding({
    licenseNumberPresent,
    expiryIso: expiryYmd,
    lastSurveyResult: facility.last_survey_result,
    facilityStatus: typeof facility.status === "string" ? facility.status : null,
  });

  const expiryCaption = formatLicensingTabExpirationCaption(expiryYmd, daysToExpiry);

  const ahcaHeaderAction = (
    <Tooltip>
      <TooltipTrigger
        type="button"
        className="inline-flex items-center gap-1.5 text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm px-1"
        aria-label="Compliance profile verifier note"
      >
        <Shield className="h-4 w-4 shrink-0" aria-hidden />
        <span className="text-xs font-normal text-muted-foreground">Compliance profile</span>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="end" className="max-w-[240px] text-xs">
        License facts below should match AHCA filings and Vault documents — use this banner as a verifier cue, not
        substitute evidence.
      </TooltipContent>
    </Tooltip>
  );

  function setScope(next: CareLicenseScope) {
    setScopeKey(next);
    scopeKeyRef.current = next;
    scheduleCareSave();
  }

  function toggleAddon(k: CareServiceAddon, checked: boolean) {
    setAddonKeys((prev) => {
      const set = new Set(prev);
      if (checked) set.add(k);
      else set.delete(k);
      const nextAddons = Array.from(set).sort((a, b) => (a === b ? 0 : a < b ? -1 : 1));
      addonKeysRef.current = nextAddons;
      return nextAddons;
    });
    window.setTimeout(() => scheduleCareSave(), 0);
  }

  function navigateSurvey(row: SurveyRow) {
    router.push(`/admin/facilities/${facilityId}/surveys/${encodeURIComponent(row.id)}`);
  }

  const lastEditor =
    typeof facility.profile_last_saved_by_full_name === "string"
      ? facility.profile_last_saved_by_full_name.trim()
      : "";

  const lastEditedLabel = formatLicensingTabLastEditedLabel(facility.updated_at, tz);

  const careDescription =
    "Circle of Life commonly operates under Enhanced Assisted Living Services when AHCA permits that tier — select the pathway that matches the certified license on file.";

  return (
    <div className="space-y-4">
      {isUpdating ? (
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Saving care pathway…
        </div>
      ) : null}

      <RecordDetailSection
        title="AHCA licensing"
        description="Use Document Vault for license PDFs. Enter authoritative license identifiers here exactly as COL received them."
        action={ahcaHeaderAction}
      >
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div className="sm:col-span-2 grid gap-1">
            {detailLabel("License status")}
            <p className="text-base font-medium text-foreground">{licenseStandingLabel(standing)}</p>
          </div>
          <div className="grid gap-1">
            {detailLabel("License number")}
            <p className="font-medium text-foreground">
              <span className="font-mono tabular-nums">{formatLicensingTabLicenseNumber(licenseNum)}</span>
              {licensePending ? <PendingBadge /> : null}
            </p>
          </div>
          <div className="grid gap-1">
            {detailLabel("Licensing authority")}
            <p className="font-medium text-foreground">{authorityLabel}</p>
          </div>

          <div className="grid gap-1">
            {detailLabel("Recorded commencement")}
            <p className="font-medium text-foreground">{formatLicensingTabYmdDate(openingYmd, tz)}</p>
            <p className="text-xs text-muted-foreground">Facility opening date on file — not a substitute for issue date lines on the AHCA PDF.</p>
          </div>
          <div className="grid gap-1">
            {detailLabel("Expiration date")}
            <p className="font-medium font-mono tabular-nums text-foreground">
              {formatLicensingTabExpirationDate(expiryYmd)}
            </p>
            <p className="text-[13px] text-muted-foreground">{expiryCaption}</p>
          </div>

          <div className="sm:col-span-2 grid gap-1">
            {detailLabel("Last survey result")}
            <p className="font-medium text-foreground">{surveyResultDisplayLabel(facility.last_survey_result)}</p>
          </div>
        </div>
      </RecordDetailSection>

      <RecordDetailSection title="Care pathway & services" description={careDescription}>
        <div className="space-y-3">
          <div>
            <p className="text-[13px] font-semibold text-foreground">License scope</p>
            <p className="mt-1 text-xs text-muted-foreground">Exactly one AHCA-assisted living pathway (mutually exclusive).</p>
            <div className="mt-3 space-y-2">
              {CARE_LICENSE_SCOPE.map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input type="radio" name="facility-license-scope" checked={scopeKey === k} onChange={() => setScope(k)} />
                  <span>{CARE_SERVICE_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="border-t border-border pt-3">
            <p className="text-[13px] font-semibold text-foreground">Additional services</p>
            <p className="mt-1 text-xs text-muted-foreground">Additive offerings layered on top of the license pathway.</p>
            <div className="mt-3 flex flex-wrap gap-4">
              {CARE_SERVICE_ADDONS.map((k) => (
                <label key={k} className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={addonKeys.includes(k)}
                    onChange={(e) => toggleAddon(k, e.target.checked)}
                  />
                  <span>{CARE_SERVICE_LABELS[k]}</span>
                </label>
              ))}
            </div>
          </div>

          <p className="border-t border-border pt-3 text-xs text-muted-foreground">
            Last recorded change · {lastEditedLabel}
            {lastEditor ? <> · by {lastEditor}</> : null}
          </p>
        </div>
      </RecordDetailSection>

      <RecordDetailSection title="Survey history">
        {surveysLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : surveys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No survey records yet.</p>
        ) : (
          <div data-testid="facility-survey-history-table" className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="text-left text-[13px] font-medium normal-case tracking-normal text-muted-foreground">
                    Date
                  </TableHead>
                  <TableHead className="text-left text-[13px] font-medium normal-case tracking-normal text-muted-foreground">
                    Type
                  </TableHead>
                  <TableHead className="text-left text-[13px] font-medium normal-case tracking-normal text-muted-foreground">
                    Result
                  </TableHead>
                  <TableHead className="text-right text-[13px] font-medium normal-case tracking-normal text-muted-foreground">
                    Citations
                  </TableHead>
                  <TableHead className="text-left text-[13px] font-medium normal-case tracking-normal text-muted-foreground">
                    Plan of correction
                  </TableHead>
                  <TableHead className="text-left text-[13px] font-medium normal-case tracking-normal text-muted-foreground">
                    Next annual target
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {surveys.map((s) => {
                  const poc = formatLicensingTabPlanOfCorrectionStatus(s);
                  const nextDueIso = approximateNextAnnualSurveyIso(s.survey_date);
                  const surveyDateLabel = formatLicensingTabSurveyDateLabel(s.survey_date);
                  const surveyDateIsPosted =
                    surveyDateLabel !== LICENSING_TAB_NO_SURVEY_DATE_POSTED_COPY;
                  return (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      tabIndex={0}
                      role="button"
                      aria-label={`Open survey record for ${s.survey_date}`}
                      onClick={() => navigateSurvey(s)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          navigateSurvey(s);
                        }
                      }}
                    >
                      <TableCell className="font-mono text-sm tabular-nums">
                        {surveyDateIsPosted && s.id ? (
                          <Link
                            href={`/admin/facilities/${facilityId}/surveys/${encodeURIComponent(s.id)}`}
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {surveyDateLabel}
                          </Link>
                        ) : (
                          surveyDateLabel
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{surveyTypeDisplayLabel(s.survey_type)}</TableCell>
                      <TableCell className="text-sm">{surveyResultDisplayLabel(s.result)}</TableCell>
                      <TableCell className="text-right text-sm tabular-nums">
                        {licensingTabCitationCountHasLink(s.citation_count) ? (
                          <Link
                            href="/admin/compliance"
                            className="text-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {formatLicensingTabCitationCount(s.citation_count)}
                          </Link>
                        ) : (
                          formatLicensingTabCitationCount(s.citation_count)
                        )}
                      </TableCell>
                      <TableCell className="text-sm">{poc}</TableCell>
                      <TableCell className="font-mono text-sm tabular-nums text-muted-foreground">
                        {formatLicensingTabNextDueDate(nextDueIso)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
            <p className="mt-2 text-xs text-muted-foreground">
              Next annual target is approximate (+365 days); confirm against the official survey disposition letter.
            </p>
          </div>
        )}
      </RecordDetailSection>

      <RecordDetailSection title="Compliance calendar">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">Planned</Badge>
          <span className="text-sm text-muted-foreground">
            Fire-drill calendars, elopement drills, and operational drill thresholds ship in the next orchestration release.
          </span>
        </div>
      </RecordDetailSection>
    </div>
  );
}

export function LicensingTab({ facilityId }: LicensingTabProps) {
  const { facility, isLoading, error, updateFacility, isUpdating } = useFacility(facilityId);
  const { surveys, isLoading: surveysLoading } = useFacilitySurveys(facilityId);

  if (isLoading || !facility) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  return (
    <LicensingTabBody
      key={`${facility.id}:${String(facility.updated_at ?? "")}`}
      facilityId={facilityId}
      facility={facility}
      surveys={surveys}
      surveysLoading={surveysLoading}
      isUpdating={isUpdating}
      updateFacility={updateFacility}
    />
  );
}
