"use client";
import { MedicaidRechecksHomeCard } from "./MedicaidRechecks";
import { MedicaidSweepHomeCard } from "./MedicaidSweep";

/** Every Medicaid card on the Facility Operator Home, behind one lazy import to keep /admin under its first-load cap. */
export function MedicaidHomeCards({ facilityId }: { facilityId: string }) {
  return (
    <>
      <MedicaidRechecksHomeCard facilityId={facilityId} />
      <MedicaidSweepHomeCard facilityId={facilityId} />
    </>
  );
}
