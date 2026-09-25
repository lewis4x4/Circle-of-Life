import Link from "next/link";

import { BenefitsQueue } from "@/components/benefits/BenefitsQueue";
import { MedicaidRechecksPanel } from "@/components/benefits/MedicaidRechecks";
import { MedicaidSweepPanel } from "@/components/benefits/MedicaidSweep";
import { cn } from "@/lib/utils";

const VIEWS = [
  { key: "queue", label: "Cases" },
  { key: "rechecks", label: "Rechecks" },
  { key: "sweep", label: "Current-resident sweep" },
] as const;

export default async function BenefitsPage({
  searchParams,
}: {
  searchParams: Promise<{ resident_id?: string; admission_case_id?: string; view?: string; facility_id?: string }>;
}) {
  const params = await searchParams;
  const view = params.view === "rechecks" || params.view === "sweep" ? params.view : "queue";
  const facilityId = params.facility_id && /^[0-9a-f-]{36}$/i.test(params.facility_id) ? params.facility_id : undefined;
  return (
    <div className="space-y-4">
      <nav aria-label="Medicaid and benefits views" className="flex flex-wrap gap-2">
        {VIEWS.map((v) => (
          <Link
            key={v.key}
            href={v.key === "queue" ? "/admin/benefits" : `/admin/benefits?view=${v.key}`}
            aria-current={view === v.key ? "page" : undefined}
            className={cn("inline-flex min-h-11 items-center rounded-md border px-3 text-sm", view === v.key ? "border-primary bg-muted font-medium" : "border-border text-muted-foreground")}
          >
            {v.label}
          </Link>
        ))}
      </nav>
      {view === "rechecks" ? <MedicaidRechecksPanel facilityId={facilityId} />
        : view === "sweep" ? <MedicaidSweepPanel facilityId={facilityId} />
        : <BenefitsQueue residentId={params.resident_id} admissionId={params.admission_case_id} />}
    </div>
  );
}
