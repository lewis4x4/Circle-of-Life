import { ControlledCountConsole } from "@/components/controlled-substance/ControlledCountConsole";

export default function MedTechControlledCountPage() {
  return (
    <ControlledCountConsole
      title="Controlled count"
      description="Record your physical count, then have an independent nurse or caregiver with facility access verify the saved counts."
      backHref="/med-tech"
      backLabel="Back to cockpit"
    />
  );
}
