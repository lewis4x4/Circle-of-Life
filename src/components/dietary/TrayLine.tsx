"use client";

import { Activity, Printer, PackageOpen } from "lucide-react";
import { VenueColumn } from "./VenueColumn";
import type { MealService, TrayTicket, VenueId } from "./types";

const VENUE_ORDER: VenueId[] = ["main_dining", "enhanced_alf", "room_trays"];

export function TrayLine({
  services,
  tickets,
  onOpen,
}: {
  services: MealService[];
  tickets: TrayTicket[];
  onOpen: (t: TrayTicket) => void;
}) {
  // Gather which venues have a service today
  const activeVenues = new Set(services.map((s) => s.venue));
  // Always show the 3 standard venues, fallback to empty columns
  const venues = VENUE_ORDER.filter((v) => activeVenues.has(v) || tickets.some((t) => t.venue === v));
  const displayVenues = venues.length > 0 ? venues : VENUE_ORDER;

  return (
    <div className="flex-1 min-w-0 flex flex-col gap-3 p-5 overflow-hidden">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white uppercase tracking-wider flex items-center gap-2">
            <Activity className="w-4 h-4 text-amber-400" /> Tray Line · Live
          </h2>
          <p className="text-xs text-stone-500 mt-0.5">Tap a ticket to scan + pass</p>
        </div>
        <div className="flex gap-2">
          <button className="px-3 py-1.5 rounded-lg bg-stone-800 hover:bg-stone-700 text-stone-200 text-xs font-medium ring-1 ring-stone-700 transition flex items-center gap-1.5">
            <Printer className="w-3.5 h-3.5" /> Reprint Sheet
          </button>
          <button className="px-3 py-1.5 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 text-xs font-semibold ring-1 ring-amber-500/40 transition flex items-center gap-1.5">
            <PackageOpen className="w-3.5 h-3.5" /> Substitute
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-3 min-h-0">
        {displayVenues.map((venue) => {
          const svc = services.find((s) => s.venue === venue);
          return (
            <VenueColumn
              key={venue}
              venue={venue}
              tickets={tickets.filter((t) => t.venue === venue)}
              totalCount={svc?.expected_count ?? 0}
              onOpen={onOpen}
            />
          );
        })}
      </div>
    </div>
  );
}
