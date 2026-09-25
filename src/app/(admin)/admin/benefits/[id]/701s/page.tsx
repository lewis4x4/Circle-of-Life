import { ScreeningSheet701S } from "@/components/benefits/ScreeningSheet701S";

export default async function ScreeningSheetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ScreeningSheet701S caseId={id} />;
}
