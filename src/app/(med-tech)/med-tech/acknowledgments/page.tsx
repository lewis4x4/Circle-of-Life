import MyAcknowledgmentsPage from "@/app/(admin)/admin/acknowledgments/my/page";
import { MedTechFacilityGate } from "@/components/med-tech/MedTechFacilityGate";

export default function MedTechAcknowledgmentsPage() {
  return (
    <MedTechFacilityGate>
      <MyAcknowledgmentsPage />
    </MedTechFacilityGate>
  );
}
