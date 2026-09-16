"use client";

import type { CareEventKind } from "@/lib/care-events/level-engine";
import { CARE_EVENT_TILES } from "@/lib/care-events/tiles";
import type { ReportResident } from "@/lib/care-events/report-state";

import { TapButton } from "./TapButton";

/**
 * Tap 2: What (spec 07A §2, §2.1). Eight tiles in two columns. With no
 * resident chosen only "Building or other" is enabled.
 */
export function ReportWhatStep({
  resident,
  onPickKind,
}: {
  resident: ReportResident | null;
  onPickKind: (kind: CareEventKind) => void;
}) {
  const buildingOnly = resident === null;
  return (
    <section className="space-y-5" aria-labelledby="report-what-heading">
      <div>
        <h2 id="report-what-heading" className="text-2xl font-semibold text-foreground">
          What happened?
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {resident ? `For ${resident.displayName}, ${resident.roomLabel}.` : "For the building, no resident chosen."}
        </p>
        {buildingOnly ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Resident tiles need a resident. Go back and tap a resident, or choose Building or other.
          </p>
        ) : null}
      </div>
      <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2" aria-label="What happened">
        {CARE_EVENT_TILES.map((tile) => {
          const disabled = buildingOnly && !tile.residentOptional;
          return (
            <li key={tile.kind}>
              <TapButton
                className="min-h-20 flex-col items-start justify-center gap-1 py-4"
                disabled={disabled}
                aria-disabled={disabled || undefined}
                onClick={() => onPickKind(tile.kind)}
              >
                <span className="text-lg font-semibold">{tile.word}</span>
                <span className="text-sm text-muted-foreground">{tile.description}</span>
              </TapButton>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
