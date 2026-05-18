"use client";

import React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

import { RecordDetailSection } from "@/design-system/components/record-detail";
import { Badge } from "@/components/ui/badge";

/**
 * Survey record detail router shell — placeholders until compliance imports full survey dossiers + deficiency links.
 */
export default function FacilitySurveyDetailPlaceholderPage() {
  const params = useParams<{ facilityId?: string | string[]; surveyId?: string | string[] }>();
  const fid = typeof params.facilityId === "string" ? params.facilityId : Array.isArray(params.facilityId) ? params.facilityId[0] : "";
  const sid = typeof params.surveyId === "string" ? params.surveyId : Array.isArray(params.surveyId) ? params.surveyId[0] : "";

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6 pt-4">
      <nav className="text-sm text-muted-foreground">
        <Link href={`/admin/facilities/${fid}?tab=licensing`} className="hover:text-foreground hover:underline">
          ← Licensing & Compliance
        </Link>
      </nav>

      <RecordDetailSection
        title="Survey record detail"
        description="This route is scaffolded so licensing history stays drill-in ready for survey dossiers."
        action={<Badge variant="secondary">Coming soon</Badge>}
      >
        <dl className="grid gap-2 text-sm">
          <div>
            <dt className="text-[13px] font-medium text-muted-foreground">Facility</dt>
            <dd className="font-mono text-xs">{fid || "—"}</dd>
          </div>
          <div>
            <dt className="text-[13px] font-medium text-muted-foreground">Survey record</dt>
            <dd className="font-mono text-xs break-all">{decodeURIComponent(sid || "—")}</dd>
          </div>
        </dl>
        <p className="mt-3 text-xs text-muted-foreground">
          Exports will eventually pull together deficiency tags, corrective action PDFs, and timeline events into a single verifier-friendly page.
        </p>
      </RecordDetailSection>
    </div>
  );
}
