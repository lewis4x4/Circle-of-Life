import { BenefitsQueue } from "@/components/benefits/BenefitsQueue";
export default async function BenefitsPage({
  searchParams,
}: {
  searchParams: Promise<{ resident_id?: string; admission_case_id?: string }>;
}) {
  const params = await searchParams;
  return (
    <BenefitsQueue
      residentId={params.resident_id}
      admissionId={params.admission_case_id}
    />
  );
}
