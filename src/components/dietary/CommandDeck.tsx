"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";

import { useDietaryToday } from "@/hooks/dietary/useDietaryToday";
import { ServiceBar } from "./ServiceBar";
import { TrayLine } from "./TrayLine";
import { ResidentWatch } from "./ResidentWatch";
import { HACCPStrip } from "./HACCPStrip";
import { PassModal } from "./PassModal";
import { VoiceModal } from "./VoiceModal";
import type { TrayTicket } from "./types";

export function CommandDeck() {
  const [activeTicket, setActiveTicket] = useState<TrayTicket | null>(null);
  const [voiceOpen, setVoiceOpen] = useState(false);

  const { services, tickets, haccp, fortification, npo, refusals, service_bar, loading, error } =
    useDietaryToday();

  if (loading) {
    return (
      <div className="h-screen w-full bg-gradient-to-br from-stone-950 via-stone-900 to-stone-950 flex items-center justify-center">
        <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-6 py-4 text-sm text-stone-300">
          <Loader2 className="h-5 w-5 animate-spin text-amber-400" />
          Loading kitchen data...
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-screen w-full bg-gradient-to-br from-stone-950 via-stone-900 to-stone-950 flex items-center justify-center">
        <div className="max-w-md rounded-2xl border border-rose-500/30 bg-rose-500/10 px-6 py-5 text-center">
          <h2 className="text-lg font-semibold text-rose-300 mb-2">Kitchen Data Unavailable</h2>
          <p className="text-sm text-stone-400">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-full bg-gradient-to-br from-stone-950 via-stone-900 to-stone-950 text-white flex flex-col font-sans antialiased overflow-hidden">
      {/* Ambient blobs */}
      <div className="pointer-events-none fixed -top-40 -left-40 w-96 h-96 rounded-full bg-amber-600/10 blur-3xl" />
      <div className="pointer-events-none fixed -bottom-40 -right-40 w-96 h-96 rounded-full bg-rose-600/10 blur-3xl" />

      <ServiceBar data={service_bar} />

      <div className="px-4 pb-4 md:px-6">
        <div className="rounded-[1.75rem] border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-xl">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-stone-400">
            <span>Kitchen priorities</span>
            <span className="text-stone-600">/</span>
            <span>{tickets.length} tray tickets</span>
            <span className="text-stone-600">/</span>
            <span>{fortification.length} fortify</span>
            <span className="text-stone-600">/</span>
            <span>{npo.length} npo</span>
            <span className="text-stone-600">/</span>
            <span>{refusals.length} refusals</span>
          </div>
          <p className="mt-2 text-sm text-stone-300">
            Keep service timing, tray execution, resident dietary watch items, and HACCP logging in one kitchen lane.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Link
              href="/admin/dietary"
              className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-stone-300 transition hover:border-white/20 hover:text-white"
            >
              Diet orders hub
            </Link>
            <Link
              href="/admin/dietary/clinical-review"
              className="rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-amber-200 transition hover:bg-amber-500/20"
            >
              Clinical review
            </Link>
          </div>
        </div>
      </div>

      <div className="flex-1 flex min-h-0">
        <TrayLine services={services} tickets={tickets} onOpen={setActiveTicket} />
        <ResidentWatch fortification={fortification} npo={npo} refusals={refusals} />
      </div>

      <HACCPStrip entries={haccp} onVoice={() => setVoiceOpen(true)} />

      <PassModal ticket={activeTicket} onClose={() => setActiveTicket(null)} />
      <VoiceModal open={voiceOpen} onClose={() => setVoiceOpen(false)} />
    </div>
  );
}
