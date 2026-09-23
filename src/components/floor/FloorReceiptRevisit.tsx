"use client";

import { CareEventReceiptRevisit } from "@/components/care-events/CareEventReceiptRevisit";

import { FloorScreenHeader } from "./FloorScreenHeader";

/** A filed report's receipt inside the floor shell: acknowledgment, who was told, notes and photos. */
export function FloorReceiptRevisit({ careEventId }: { careEventId: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FloorScreenHeader back={{ href: "/floor", label: "Back to Now" }} title="Report" subtitle="Add a note or a photo, and see who was told." />
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6">
        <CareEventReceiptRevisit careEventId={careEventId} doneHref="/floor" doneLabel="Back to Now" />
      </div>
    </div>
  );
}
