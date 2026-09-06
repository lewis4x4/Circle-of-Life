"use client";

import React, { useState } from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { TourSchedulerModal } from "@/components/web/tour-scheduler-modal";
import { RegionalMap } from "@/components/web/regional-map";
import { CampusGrid } from "@/components/web/campus-grid";
import { Compass } from "lucide-react";
import Image from "next/image";

export default function CampusesPage() {
  const [tourModalOpen, setTourModalOpen] = useState(false);
  const [selectedTourFacility, setSelectedTourFacility] = useState<string | undefined>();

  const handleOpenTour = (facilityId?: string) => {
    setSelectedTourFacility(facilityId);
    setTourModalOpen(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1C2822] font-sans">
      <WebHeader onOpenTourModal={() => handleOpenTour()} />

      <main className="flex-1">
        {/* Luxury Hero Banner */}
        <section className="relative overflow-hidden bg-stone-950 text-white py-20 sm:py-28">
          <Image
            src="https://images.unsplash.com/photo-1518780664697-55e3ad937233?auto=format&fit=crop&w=1600&q=80"
            alt="North Florida Campuses"
            className="absolute inset-0 w-full h-full object-cover opacity-25" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-300/30">
              <Compass className="w-3.5 h-3.5 text-[#C85A32]" />
              <span>5 Campuses • 258 Licensed Beds • 3 Counties</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl mx-auto leading-tight">
              Our North Florida Sanctuaries
            </h1>
            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal">
              Explore our five residential estates across Lake City, Live Oak, and Mayo.
              Every campus offers 24-hour loving care, home-cooked Southern meals, and single-story accessibility.
            </p>
          </div>
        </section>

        {/* 5 Campuses Grid */}
        <CampusGrid onOpenTourModal={handleOpenTour} />

        {/* Regional Map & Hospital Drive Times */}
        <RegionalMap />
      </main>

      <WebFooter />
      <StickyCareConcierge onOpenTourModal={() => handleOpenTour()} />
      <TourSchedulerModal
        isOpen={tourModalOpen}
        onClose={() => setTourModalOpen(false)}
        defaultFacilityId={selectedTourFacility}
      />
    </div>
  );
}
