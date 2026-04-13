"use client";

import { Utensils, Heart, Soup } from "lucide-react";
import { TrayCard } from "./TrayCard";
import type { TrayTicket, VenueId } from "./types";

const VENUE_META: Record<VenueId, { label: string; color: string; Icon: React.ElementType<{ className?: string }> }> = {
  main_dining:  { label: "Main Dining",  color: "from-amber-500 to-orange-500", Icon: Utensils },
  memory_care:  { label: "Memory Care",  color: "from-violet-500 to-fuchsia-500", Icon: Heart },
  room_trays:   { label: "Room Trays",   color: "from-sky-500 to-cyan-500", Icon: Soup },
};

export function VenueColumn({
  venue,
  tickets,
  totalCount,
  onOpen,
}: {
  venue: VenueId;
  tickets: TrayTicket[];
  totalCount: number;
  onOpen: (t: TrayTicket) => void;
}) {
  const meta = VENUE_META[venue] ?? VENUE_META.main_dining;
  const Icon = meta.Icon;

  return (
    <div className="flex-1 min-w-0 flex flex-col">
      <div className={`px-4 py-3 rounded-t-2xl bg-gradient-to-r ${meta.color} flex items-center justify-between`}>
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4 text-white" />
          <h3 className="text-sm font-semibold text-white">{meta.label}</h3>
        </div>
        <span className="text-xs font-mono text-white/80 bg-black/20 px-2 py-0.5 rounded-md">
          {tickets.length}/{totalCount}
        </span>
      </div>
      <div className="flex-1 bg-stone-900/40 rounded-b-2xl ring-1 ring-stone-800 p-3 space-y-2 overflow-y-auto">
        {tickets.map((t) => (
          <TrayCard key={t.id} ticket={t} onOpen={onOpen} />
        ))}
        {tickets.length === 0 && (
          <div className="text-center text-stone-600 text-xs py-6">No tickets</div>
        )}
      </div>
    </div>
  );
}
