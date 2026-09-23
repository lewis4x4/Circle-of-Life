import { ControlledCountConsole } from "@/components/controlled-substance/ControlledCountConsole";

export default function MedTechControlledCountPage() {
  return (
    <div className="mx-auto w-full max-w-3xl p-4 md:p-8">
      <ControlledCountConsole
        title="Controlled count"
        description="Record your physical count, then have an independent nurse or caregiver with facility access verify the saved counts."
        backHref="/med-tech"
        backLabel="Back to cockpit"
      />
    </div>
  );
}
