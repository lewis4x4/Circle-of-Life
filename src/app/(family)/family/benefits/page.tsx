import { BenefitsFamilyCollection } from "@/components/benefits/BenefitsFamilyCollection";
export default function FamilyBenefitsPage() {
  return <div className="mx-auto max-w-3xl space-y-6 px-4 pb-10 pt-24 sm:px-6"><div><h1 className="text-2xl font-semibold tracking-tight">Requested documents</h1><p className="mt-2 text-muted-foreground">Securely return the benefits documents your care team has requested.</p></div><BenefitsFamilyCollection /></div>;
}
