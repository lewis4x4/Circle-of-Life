import { BenefitsCaseWorkspace } from "@/components/benefits/BenefitsCaseWorkspace";
export default async function BenefitsCasePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <BenefitsCaseWorkspace id={id} />;
}
