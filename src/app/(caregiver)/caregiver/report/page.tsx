import { Suspense } from "react";

import { CareEventReportFlow } from "@/components/care-events/CareEventReportFlow";
import { isCareEventKind } from "@/lib/care-events/level-engine";
import { UUID_STRING_RE } from "@/lib/supabase/env";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * `/caregiver/report`: the three-tap "Something happened" flow (spec 07A §6.4).
 * `?resident=<uuid>` skips Who; `?kind=<kind>` skips What.
 */
export default async function CaregiverReportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const residentParam = first(params.resident);
  const kindParam = first(params.kind);
  const prefillResidentId = residentParam && UUID_STRING_RE.test(residentParam) ? residentParam : null;
  const prefillKind = isCareEventKind(kindParam) ? kindParam : null;

  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Opening Something happened
        </p>
      }
    >
      <CareEventReportFlow prefillResidentId={prefillResidentId} prefillKind={prefillKind} />
    </Suspense>
  );
}
