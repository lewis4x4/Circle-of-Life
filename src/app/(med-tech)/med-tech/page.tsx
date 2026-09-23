import { Cockpit } from "@/components/med-tech/Cockpit";

export default function MedTechCockpitPage() {
  return (
    <>
      {/* The cockpit's panels are h2s; the page needs its one h1 (COL-658). */}
      <h1 className="sr-only">Med-Tech cockpit</h1>
      <Cockpit />
    </>
  );
}
