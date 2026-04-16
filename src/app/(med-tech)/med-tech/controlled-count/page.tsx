import { ControlledCountConsole } from "@/components/controlled-substance/ControlledCountConsole";

export default function MedTechControlledCountPage() {
  return (
    <ControlledCountConsole
      title="Controlled count"
      description="Shift reconciliation for controlled medications from the med-tech lane"
      backHref="/med-tech"
      backLabel="Back to cockpit"
    />
  );
}
