import { FloorReceiptRevisit } from "@/components/floor/FloorReceiptRevisit";

/** `/floor/report/[careEventId]`: reopen a report to add a note or photo (spec 40 §6 screen 6). */
export default async function FloorReportReceiptPage({ params }: { params: Promise<{ careEventId: string }> }) {
  const { careEventId } = await params;
  return <FloorReceiptRevisit careEventId={careEventId} />;
}
