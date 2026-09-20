import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsFixture } from "./settings-fixture";
import { IntegrityCompliancePanel } from "@/components/rounding/IntegrityCompliancePanel";
import { QuickCheckDrawer } from "@/components/rounding/QuickCheckDrawer";
import { ObservationCapture } from "@/components/rounding/ObservationCapture";
import type { CompletionPayload } from "@/lib/rounding/types";
import "@/app/globals.css";

function Fixture() {
  const drawer = new URLSearchParams(window.location.search).get("screen") === "drawer";
  const [drawerOpen, setDrawerOpen] = useState(true);
  const [completed, setCompleted] = useState(false);
  const capture = new URLSearchParams(window.location.search).get("screen") === "capture";
  const [facility, setFacility] = useState("fixture-a");
  const [saved, setSaved] = useState<CompletionPayload | null>(null);
  return <main className="mx-auto max-w-5xl space-y-6 p-4 md:p-8">
    <header className="space-y-2"><h1 className="text-2xl font-semibold">Smart Rounding</h1>
      <p className="text-sm text-muted-foreground">Synthetic component proof — no resident data or live session</p></header>
    {new URLSearchParams(window.location.search).get("screen") === "settings" ? <SettingsFixture /> : drawer ? <>
      <QuickCheckDrawer task={{ id: "synthetic-task", organizationId: "synthetic-org", facilityId: facility, residentName: "Fixture Resident", roomLabel: "Fixture room", dueAt: "2026-09-20T16:00:00Z", status: "due" }} open={drawerOpen} persistCompletion={false} onClose={() => setDrawerOpen(false)} onCompleted={() => setCompleted(true)} />
      {completed ? <output>Synthetic admin capture completed</output> : null}
    </> : capture ? <>
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
