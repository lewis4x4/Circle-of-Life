import Link from "next/link";
import { Users } from "lucide-react";

import type { PresenceCensus } from "@/lib/executive/presence-census";
import { cn } from "@/lib/utils";

import { CARD_CLASS, CARD_HEAD_CLASS, LINK_BUTTON_CLASS } from "./home-styles";

export type PresenceTilesProps = {
  presence: PresenceCensus;
  available: boolean;
  licensedBeds: number | null;
  standUpCensus: { value: number; weekStart: string } | null;
};

/**
 * Residents today: counts only, never names. Each tile opens the roster
 * filtered to that residency status. A Stand Up figure that disagrees with the
 * roster is shown on the tile, not hidden (COL-555).
 */
export function PresenceTiles({ presence, available, licensedBeds, standUpCensus }: PresenceTilesProps) {
  const openBeds = licensedBeds == null ? null : Math.max(0, licensedBeds - presence.total);
  const disagreement = standUpCensus && available && standUpCensus.value !== presence.total ? standUpCensus : null;
  const subtitle = !available
    ? "Roster counts unavailable right now."
    : `${presence.total} on census${licensedBeds != null ? ` · ${licensedBeds} licensed beds · ${openBeds} open` : ""}. Every held bed counts.`;
  const tiles = [
    { key: "active", value: presence.inHouse, label: "In house", sub: "Roster · in the building", tone: "" },
    { key: "hospital", value: presence.hospital, label: "Hospital", sub: "Bed held", tone: "text-warning" },
    { key: "loa", value: presence.onLeave, label: "On leave", sub: "Bed held", tone: "" },
  ];
  return (
    <section className={cn(CARD_CLASS, "overflow-hidden")} aria-labelledby="presence-heading">
      <div className={CARD_HEAD_CLASS}>
        <div>
          <h2 id="presence-heading" className="flex items-center gap-2 text-[15px] font-semibold tracking-tight text-foreground">
            <Users className="size-4 text-muted-foreground" aria-hidden /> Residents today
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <Link href="/admin/residents" className={LINK_BUTTON_CLASS}>Roster →</Link>
      </div>
      <div className="grid grid-cols-3 gap-px bg-border/60">
        {tiles.map((tile) => (
          <Link
            key={tile.key}
            href={`/admin/residents?status=${tile.key}`}
            className="flex flex-col gap-0.5 bg-card px-4 py-3.5 text-left hover:bg-secondary/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
            aria-label={`${tile.label}: ${available ? tile.value : "unavailable"}. Open the roster filtered to ${tile.label.toLowerCase()}.`}
          >
            <span className={cn("text-[26px] font-semibold leading-none tracking-tight tabular-nums", tile.tone)} data-testid={`presence-${tile.key}`}>
              {available ? tile.value : "—"}
            </span>
            <span className="text-xs text-muted-foreground">{tile.label}</span>
            <span className="text-[11px] text-muted-foreground/70">{tile.sub}</span>
          </Link>
        ))}
      </div>
      {disagreement ? (
        <p className="border-t border-dashed border-border bg-background/40 px-4 py-2.5 text-xs text-warning" role="note">
          Weekly Stand Up reported {disagreement.value} for the week of {disagreement.weekStart}; the roster shows {presence.total}. The difference is being reconciled — neither number is hidden.
        </p>
      ) : null}
    </section>
  );
}
