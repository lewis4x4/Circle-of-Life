import { Suspense } from "react";
import { notFound } from "next/navigation";

import { CareEventReceiptRevisit } from "@/components/care-events/CareEventReceiptRevisit";
import { UUID_STRING_RE } from "@/lib/supabase/env";

/**
 * `/caregiver/report/[careEventId]`: receipt revisit (spec 07A §6.4).
 */
export default async function CaregiverReportReceiptPage({
  params,
}: {
  params: Promise<{ careEventId: string }>;
}) {
  const { careEventId } = await params;
  if (!UUID_STRING_RE.test(careEventId)) notFound();

  return (
    <Suspense
      fallback={
        <p role="status" className="text-sm text-muted-foreground">
          Opening the receipt
        </p>
      }
    >
      <CareEventReceiptRevisit careEventId={careEventId} />
    </Suspense>
  );
}
