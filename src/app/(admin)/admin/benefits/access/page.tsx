import { BenefitsAccess } from "@/components/benefits/BenefitsAccess";
import { BenefitsRules } from "@/components/benefits/BenefitsRules";
export default function BenefitsAccessPage() {
  return (
    <>
      <BenefitsAccess />
      <div className="mx-auto max-w-5xl pb-24">
        <BenefitsRules />
      </div>
    </>
  );
}
