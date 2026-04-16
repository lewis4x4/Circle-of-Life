"use client";

import { ControlledCountConsole } from "@/components/controlled-substance/ControlledCountConsole";

export default function CaregiverControlledCountPage() {
  return (
    <ControlledCountConsole
      title="Controlled count"
      description="Shift reconciliation for scheduled medications"
      backHref="/caregiver/meds"
      backLabel="Back to Meds"
    />
  );
}
