import { OverrideAdmissionForm } from "@/components/residents/OverrideAdmissionForm";

/** Product alias: `/clinical/residents/add` (canonical implementation: `/admin/residents/new`). */
export default function ClinicalResidentsAddPage() {
  return (
    <div className="mx-auto max-w-3xl">
      <OverrideAdmissionForm cancelHref="/clinical/residents" admissionsHref="/pipeline/admissions/new" />
    </div>
  );
}
