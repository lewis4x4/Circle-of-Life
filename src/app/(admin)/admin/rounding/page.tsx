import { Suspense } from "react";

import { LiveBoard } from "@/components/rounding/LiveBoard";

/**
 * Smart Rounding lands on the Live board. Spec 25A defect 9.
 *
 * There is no Overview page any more. An overview of the board, one route away
 * from the board, was a second destination whose only content was counts the
 * board already carries, and it was where the retired 2026-08-14 cadence apply
 * panel lived.
 *
 * The board reads `?filter=escalated`, so the links that used to point at the
 * Escalations tab still land an operator on the right rows. Reading a search
 * param makes the board a client boundary, hence the Suspense wrapper.
 */
export default function AdminRoundingPage() {
  return (
    <Suspense fallback={null}>
      <LiveBoard />
    </Suspense>
  );
}
