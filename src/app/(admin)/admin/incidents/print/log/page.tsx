import { Suspense } from "react";

import { IncidentReportsLogPageClient } from "@/components/care-events/print/IncidentReportsLogPageClient";

/**
 * The paper Incident Reports Log for one facility and date range (spec 07A
 * §6.2, Appendix A), in the log's own column order. The print is recorded
 * before the sheet renders.
 */
export default function IncidentReportsLogPrintPage() {
  return (
    <Suspense fallback={null}>
      <IncidentReportsLogPageClient />
    </Suspense>
  );
}
