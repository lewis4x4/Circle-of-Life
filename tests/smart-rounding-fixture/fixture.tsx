import { useState } from "react";
import { createRoot } from "react-dom/client";
import { IntegrityCompliancePanel } from "@/components/rounding/IntegrityCompliancePanel";
import { ObservationCapture } from "@/components/rounding/ObservationCapture";
import type { CompletionPayload } from "@/lib/rounding/types";
import "@/app/globals.css";

function Fixture() {
  const capture = new URLSearchParams(window.location.search).get("screen") === "capture";
  const [facility, setFacility] = useState("fixture-a");
  const [saved, setSaved] = useState<CompletionPayload | null>(null);
  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Smart Rounding</h1>
      <p className="text-sm text-muted-foreground">Synthetic component proof — no resident data or live session</p></header>
    {capture ? <>
      <ObservationCapture residentName="Fixture Resident" dueLabel="Meal check · 12:00 PM" facilityId={facility} onSubmit={setSaved} />
      {saved ? <output aria-label="Saved synthetic observation">{JSON.stringify(saved)}</output> : null}
    </> : <>
      <button className="rounded border p-3" onClick={() => setFacility("fixture-b")}>Switch to Fixture B</button>
      <h2 className="text-lg font-semibold">{facility === "fixture-a" ? "Fixture A" : "Fixture B"}</h2>
      <IntegrityCompliancePanel facilityId={facility} />
    </>}
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
