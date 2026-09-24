import { FloorReportRoute } from "@/components/floor/FloorReportRoute";
import { isCareEventKind } from "@/lib/care-events/level-engine";
import { UUID_STRING_RE } from "@/lib/supabase/env";

type SearchParams = Promise<{ [key: string]: string | string[] | undefined }>;

function first(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

/**
 * `/floor/report`: "Something happened" on the floor tablet (spec 40 §6 screen 6).
 * `?resident=<uuid>` picks who; `?kind=<kind>` picks what, as on `/caregiver/report`.
 */
export default async function FloorReportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const residentParam = first(params.resident);
  const kindParam = first(params.kind);
  return (
    <FloorReportRoute
      prefillResidentId={residentParam && UUID_STRING_RE.test(residentParam) ? residentParam : null}
      prefillKind={isCareEventKind(kindParam) ? kindParam : null}
    />
  );
}
