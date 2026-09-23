import { FloorResidentScreen } from "@/components/floor/FloorResidentScreen";

/** `/floor/residents/[id]`, Tier 2 (spec 40 §6 screen 4). */
export default async function FloorResidentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FloorResidentScreen residentId={id} />;
}
