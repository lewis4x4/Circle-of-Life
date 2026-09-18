import { CareEventPrintPageClient } from "@/components/care-events/print/CareEventPrintPageClient";

/**
 * COL's Incident Form, Sections 1 to 4, for one care event (spec 07A Appendix A).
 * Linked from the Administrator's completion form. The print is recorded before
 * the sheet renders.
 */
export default async function IncidentFormPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CareEventPrintPageClient careEventId={id} sheet="incident_form" />;
}
