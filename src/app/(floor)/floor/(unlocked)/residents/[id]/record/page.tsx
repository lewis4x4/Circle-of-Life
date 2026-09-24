import { FloorResidentRecord } from "@/components/floor/FloorResidentRecord";

/** `/floor/residents/[id]/record`, Tier 3: the resident timeline inside the tablet shell. */
export default async function FloorResidentRecordPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <FloorResidentRecord residentId={id} />;
}
