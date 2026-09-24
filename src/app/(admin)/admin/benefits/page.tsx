import { BenefitsQueue } from "@/components/benefits/BenefitsQueue";
import { MedicaidRechecksPanel } from "@/components/benefits/MedicaidRechecks";
export default async function BenefitsPage({
  searchParams,
}: {
  searchParams: Promise<{ resident_id?: string; admission_case_id?: string; view?: string; facility_id?: string }>;
}) {
  const params = await searchParams;
  if (params.view === "rechecks") {
    return <MedicaidRechecksPanel facilityId={params.facility_id && /^[0-9a-f-]{36}$/i.test(params.facility_id) ? params.facility_id : undefined} />;
  }
  return (
    <BenefitsQueue
      residentId={params.resident_id}
      admissionId={params.admission_case_id}
    />
  );
}
