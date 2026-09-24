"use client";

import React from "react";
import Link from "next/link";
import { Phone, Calendar } from "lucide-react";

interface StickyCareConciergeProps {
  onOpenTourModal?: () => void;
}

export function StickyCareConcierge({ onOpenTourModal }: StickyCareConciergeProps) {
  return (
    <>
    {/* In-flow spacer the height of the fixed bar, so the last content on the
        page is never hidden behind it on a phone (COL-687). */}
    <div aria-hidden data-slot="sticky-care-concierge-spacer" className="h-[calc(4.5rem+env(safe-area-inset-bottom))] lg:hidden" />
    <aside aria-label="Quick contact" className="lg:hidden fixed bottom-0 left-0 right-0 z-40 bg-[#1e2b24]/95 backdrop-blur-md border-t border-stone-700/80 p-2.5 shadow-2xl safe-bottom">
      <div className="flex items-center justify-between gap-2 max-w-lg mx-auto">
        <a
          href="tel:3864060887"
          className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-xl bg-stone-800 text-white font-bold text-xs border border-stone-700 active:scale-95 transition-transform"
        >
          <Phone className="w-4 h-4 text-amber-400 animate-bounce" />
          <span>Call 24/7 (386) 406-0887</span>
        </a>

        <Link
          href="/tour"
          onClick={onOpenTourModal}
          className="flex-1 flex items-center justify-center gap-2 py-3 px-3 rounded-xl bg-[#c86d51] text-white font-bold text-xs shadow-lg shadow-[#c86d51]/30 active:scale-95 transition-transform"
        >
          <Calendar className="w-4 h-4 text-amber-200" />
          <span>Book Tour & Lunch</span>
        </Link>
      </div>
    </aside>
    </>
  );
}
