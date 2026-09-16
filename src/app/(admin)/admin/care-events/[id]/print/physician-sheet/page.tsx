import { CareEventPrintPageClient } from "@/components/care-events/print/CareEventPrintPageClient";

/**
 * The physician notification sheet that goes out by fax (COL-354). A print
 * view, not a fax integration: the administrator prints it, faxes it, then
 * records the physician notification on the completion form.
 */
export default async function PhysicianSheetPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CareEventPrintPageClient careEventId={id} sheet="physician_sheet" />;
}
