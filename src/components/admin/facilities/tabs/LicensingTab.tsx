"use client";

import React, { useState } from "react";
import { Loader2, Shield } from "lucide-react";
import { useFacility } from "@/hooks/useFacility";
import { useFacilitySurveys } from "@/hooks/useFacilitySurveys";
import { CARE_SERVICES, CARE_SERVICE_LABELS } from "@/lib/admin/facilities/facility-constants";

interface LicensingTabProps {
  facilityId: string;
}

function PendingBadge() {
  return (
    <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900">
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
        <Loader2 className="h-8 w-8 animate-spin text-teal-500" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  const licenseNum = facility.ahca_license_number ?? facility.license_number;
  const licensePending = !licenseNum;

  return (
    <div className="space-y-8">
      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <Shield className="h-5 w-5 text-teal-600" />
          AHCA licensing
        </h3>
        <div className="grid gap-4 sm:grid-cols-2 text-sm">
          <div>
            <p className="text-muted-foreground">License number</p>
            <p className="font-medium">
              {licenseNum ?? "—"}
              {licensePending && <PendingBadge />}
            </p>
          </div>
          <div>
            <p className="text-muted-foreground">License authority</p>
            <p className="font-medium">{facility.license_authority ?? "—"}</p>
          </div>
          <div>
            <p className="text-muted-foreground">Last survey result</p>
            <p className="font-medium">{facility.last_survey_result ?? "—"}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          Use Document Vault for license PDFs. Enter definitive license numbers here when received from COL.
        </p>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6 space-y-4">
        <h3 className="text-lg font-semibold">Care services offered</h3>
        <p className="text-sm text-muted-foreground">
          COL uses <strong>Enhanced ALF Services</strong> — never label as &quot;Memory Care&quot; in compliance-facing
          outputs.
        </p>
        <div className="flex flex-wrap gap-3">
          {CARE_SERVICES.map((s) => (
            <label key={s} className="flex items-center gap-2 text-sm">
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
        <button
          type="button"
          onClick={() => void saveCareServices()}
          disabled={isUpdating}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {isUpdating ? "Saving…" : "Save care services"}
        </button>
      </section>

      <section className="rounded-lg border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold mb-4">Survey history</h3>
        {surveysLoading ? (
          <Loader2 className="h-6 w-6 animate-spin text-teal-500" />
        ) : surveys.length === 0 ? (
          <p className="text-sm text-muted-foreground">No survey records yet.</p>
        ) : (
          <ul className="divide-y">
            {surveys.map((s) => (
              <li key={s.id} className="py-3 flex justify-between gap-4 text-sm">
                <div>
                  <p className="font-medium">{s.survey_date}</p>
                  <p className="text-muted-foreground">
                    {s.survey_type} — {s.result}
                  </p>
                </div>
                {s.citation_count > 0 && (
                  <span className="text-amber-700 text-xs">{s.citation_count} citations</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-muted-foreground">
        Compliance calendar (fire drills, elopement drills) will tie to operational thresholds and scheduling in a
        follow-up pass.
      </section>
    </div>
  );
}
