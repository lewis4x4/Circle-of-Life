"use client";

import React, { useState } from "react";
import { Loader2, Shield } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { useFacilitySurveys } from "@/hooks/useFacilitySurveys";
import { CARE_SERVICES, CARE_SERVICE_LABELS } from "@/lib/admin/facilities/facility-constants";
import { RecordDetailSection } from "@/design-system/components/record-detail";

interface LicensingTabProps {
  facilityId: string;
}

function PendingBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded-[8px] bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning">
      Pending
    </span>
  );
}

export function LicensingTab({ facilityId }: LicensingTabProps) {
  const { facility, isLoading, error, updateFacility, isUpdating } = useFacility(facilityId);
  const { surveys, isLoading: surveysLoading } = useFacilitySurveys(facilityId);
  const [care, setCare] = useState<string[] | null>(null);

  React.useEffect(() => {
    if (facility?.care_services_offered) {
      setCare(facility.care_services_offered as string[]);
    }
  }, [facility?.care_services_offered]);

  async function saveCareServices() {
    if (!care?.length) return;
    await updateFacility({ care_services_offered: care as ("standard_alf" | "enhanced_alf_services" | "respite_care" | "adult_day_services")[] });
  }

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

  const licenseNum = facility.ahca_license_number ?? facility.license_number;
  const licensePending = !licenseNum;

  return (
    <div className="space-y-4">
      <RecordDetailSection
        title="AHCA licensing"
        action={<Shield className="h-4 w-4 text-muted-foreground" />}
        description="Use Document Vault for license PDFs. Enter definitive license numbers here when received from COL."
      >
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">License number</p>
            <p className="font-medium text-foreground mt-1">
              {licenseNum ?? "—"}
              {licensePending && <PendingBadge />}
            </p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">License authority</p>
            <p className="font-medium text-foreground mt-1">{facility.license_authority ?? "—"}</p>
          </div>
          <div>
            <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground">Last survey result</p>
            <p className="font-medium text-foreground mt-1">{facility.last_survey_result ?? "—"}</p>
          </div>
        </div>
      </RecordDetailSection>

      <RecordDetailSection
        title="Care services offered"
        description="COL uses Enhanced ALF Services — avoid legacy unit marketing labels in compliance-facing outputs (see Haven verification checklist)."
        action={
          <button
            type="button"
            onClick={() => void saveCareServices()}
            disabled={isUpdating}
            className="rounded-[8px] bg-primary px-3 py-1.5 text-sm text-primary-foreground disabled:opacity-50"
          >
            {isUpdating ? "Saving…" : "Save"}
          </button>
        }
      >
        <div className="flex flex-wrap gap-3">
          {CARE_SERVICES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm text-foreground">
              <input
                type="checkbox"
                checked={(care ?? (facility.care_services_offered as string[] | undefined) ?? []).includes(s)}
                onChange={(e) => {
                  const base = care ?? (facility.care_services_offered as string[] | undefined) ?? [];
                  if (e.target.checked) setCare([...base, s]);
                  else setCare(base.filter((x) => x !== s));
                }}
              />
              {CARE_SERVICE_LABELS[s]}
            </label>
          ))}
        </div>
      </RecordDetailSection>

      <RecordDetailSection title="Survey history">
        {surveysLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        ) : surveys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No survey records yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {surveys.map((s) => (
              <li key={s.id} className="py-3 flex justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium text-foreground">{s.survey_date}</p>
                  <p className="text-[10px] font-medium tracking-wider uppercase text-muted-foreground mt-0.5">
                    {s.survey_type} — {s.result}
                  </p>
                </div>
                {s.citation_count > 0 && (
                  <span className="tabular-nums text-warning text-xs">{s.citation_count} citations</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </RecordDetailSection>

      <div className="rounded-[8px] border border-dashed border-border bg-muted/10 p-4 text-sm text-muted-foreground">
        Compliance calendar (fire drills, elopement drills) will tie to operational thresholds and scheduling in a follow-up pass.
      </div>
    </div>
  );
}
