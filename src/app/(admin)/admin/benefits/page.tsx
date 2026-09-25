import Link from "next/link";

import { BenefitsQueue } from "@/components/benefits/BenefitsQueue";
import { MedicaidBoard } from "@/components/benefits/MedicaidBoard";
import { MedicaidPromptsPanel } from "@/components/benefits/MedicaidPrompts";
import { MedicaidRechecksPanel } from "@/components/benefits/MedicaidRechecks";
import { MedicaidSweepPanel } from "@/components/benefits/MedicaidSweep";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "board", label: "Board" },
  { key: "cases", label: "Cases" },
  { key: "rechecks", label: "Rechecks" },
  { key: "sweep", label: "Current-resident sweep" },
] as const;
type View = (typeof VIEWS)[number]["key"];

export default async function BenefitsPage({
  searchParams,
}: {
  searchParams: Promise<{ resident_id?: string; admission_case_id?: string; view?: string; facility_id?: string }>;
}) {
  const params = await searchParams;
  // Links that filter by resident or admission keep opening the case list they always opened.
  const view: View = VIEWS.some((v) => v.key === params.view) ? (params.view as View) : params.resident_id || params.admission_case_id ? "cases" : "board";
  const facilityId = params.facility_id && /^[0-9a-f-]{36}$/i.test(params.facility_id) ? params.facility_id : undefined;
  return (
    <div className="space-y-4">
      <nav aria-label="Medicaid and benefits views" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "board" ? "/admin/benefits" : `/admin/benefits?view=${v.key}`}
            aria-current={view === v.key ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center rounded-md border px-3 text-sm", view === v.key ? "border-primary bg-muted font-medium" : "border-border text-muted-foreground")}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "board" && <><MedicaidPromptsPanel /><MedicaidBoard /></>}
      {view === "cases" && <BenefitsQueue residentId={params.resident_id} admissionId={params.admission_case_id} />}
      {view === "rechecks" && <MedicaidRechecksPanel facilityId={facilityId} />}
      {view === "sweep" && <MedicaidSweepPanel facilityId={facilityId} />}
    </div>
  );
}
