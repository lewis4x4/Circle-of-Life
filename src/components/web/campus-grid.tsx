"use client";

import React, { useState } from "react";
import Link from "next/link";
import {
  Calendar,
  ArrowRight,
  CheckCircle2,
  Compass,
} from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";
import Image from "next/image";

interface CampusGridProps {
  onOpenTourModal?: (facilityId?: string) => void;
}

export function CampusGrid({ onOpenTourModal }: CampusGridProps) {
  const [selectedCounty, setSelectedCounty] = useState<string>("all");

  const filteredFacilities =
    selectedCounty === "all"
      ? FACILITIES
      : FACILITIES.filter((f) =>
          f.address.county.toLowerCase().includes(selectedCounty.toLowerCase())
        );

  return (
    <section id="locations" className="py-24 bg-[#FAF7F2]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between mb-14 gap-6">
          <div className="max-w-2xl space-y-2">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#3D5A4C]/10 text-[#3D5A4C] text-xs font-bold uppercase tracking-widest">
              <Compass className="w-3.5 h-3.5 text-[#A94724]" />
              <span>5 North Florida Campuses</span>
            </div>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C2822] font-serif leading-tight">
              Five Peaceful Estates. One Loving Standard of Care.
            </h2>
            <p className="text-stone-600 text-sm sm:text-base leading-relaxed">
              Every Circle of Life community is intentionally built single-story for easy mobility,
              surrounded by towering live oaks and pine groves, and led by on-site Executive Directors who treat you like family.
            </p>
          </div>

          {/* County Filter Tabs */}
          <div className="flex items-center gap-2 bg-stone-200/90 p-1.5 rounded-2xl self-start md:self-auto border border-stone-300">
            {[
              { id: "all", label: "All 5 Homes" },
              { id: "columbia", label: "Lake City (2)" },
              { id: "suwannee", label: "Live Oak (1)" },
              { id: "lafayette", label: "Mayo (2)" },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setSelectedCounty(tab.id)}
                className={`px-4 py-2 text-xs font-bold rounded-xl transition-all ${
                  selectedCounty === tab.id
                    ? "bg-[#1C2822] text-white shadow-md"
                    : "text-stone-700 hover:text-stone-950"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        {/* 5-Campus Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredFacilities.map((facility, index) => (
            <div
              key={facility.id}
              className={`flex flex-col rounded-3xl bg-white border-2 border-stone-200/90 shadow-md hover:shadow-2xl transition-all duration-300 overflow-hidden group ${
                index === 0 && selectedCounty === "all" ? "md:col-span-2 lg:col-span-2" : ""
              }`}
            >
              {/* Card Image Container */}
              <div className="relative h-68 sm:h-76 w-full overflow-hidden bg-stone-900">
                <Image
                  src={facility.image}
                  alt={facility.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-700" unoptimized loading="eager" fill sizes="100vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/35 to-transparent" />

                {/* Floating Top Badges */}
                <div className="absolute top-4 left-4 right-4 flex items-center justify-between">
                  <span className="px-3 py-1 rounded-full bg-[#1C2822]/90 backdrop-blur-sm text-[#F3EFE6] text-xs font-bold shadow-sm border border-stone-700">
                    {facility.address.city}, FL
                  </span>

                  <span className="px-3 py-1 rounded-full bg-emerald-700 text-white text-xs font-bold shadow-sm flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-pulse" />
                    {facility.availableBeds} Suites Available
                  </span>
                </div>

                {/* Bottom Overlay Title & County */}
                <div className="absolute bottom-4 left-5 right-5 text-white">
                  <div className="text-[11px] uppercase tracking-widest text-[#E5A952] font-bold mb-1">
                    {facility.address.county} • {facility.licensedBeds} Licensed Beds
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold font-serif leading-tight">
                    {facility.name}
                  </h3>
                </div>
              </div>

              {/* Card Content Body */}
              <div className="p-7 flex-1 flex flex-col justify-between space-y-6">
                <div>
                  <p className="text-sm text-stone-600 leading-relaxed mb-5 font-normal">
                    {facility.heroDescription}
                  </p>

                  {/* Highlights Bullet List */}
                  <div className="space-y-2.5 text-xs text-stone-800 font-medium">
                    {facility.highlights.slice(0, 3).map((item, idx) => (
                      <div key={idx} className="flex items-start gap-2.5">
                        <CheckCircle2 className="w-4 h-4 text-[#A94724] shrink-0 mt-0.5" />
                        <span>{item}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Administrator & Pricing Bar */}
                <div className="pt-5 border-t border-stone-200 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-stone-600 block text-[11px] uppercase tracking-wider font-semibold">
                      Executive Director
                    </span>
                    <span className="font-bold text-sm text-[#1C2822]">{facility.administrator.name}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-stone-600 block text-[11px] uppercase tracking-wider font-semibold">
                      All-Inclusive From
                    </span>
                    <span className="font-bold text-[#A94724] text-lg sm:text-xl font-serif">
                      ${facility.pricing.semiPrivate.toLocaleString()}
                      <span className="text-xs text-stone-600 font-sans font-normal"> / mo</span>
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <Link
                    href={`/campuses/${facility.slug}`}
                    className="inline-flex items-center justify-center gap-2 py-3 px-3 rounded-2xl bg-stone-100 hover:bg-stone-200 text-[#1C2822] font-bold text-xs transition-colors text-center border border-stone-300"
                  >
                    <span>View Campus</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>

                  <button
                    onClick={() => {
                      if (onOpenTourModal) onOpenTourModal(facility.id);
                    }}
                    className="inline-flex items-center justify-center gap-1.5 py-3 px-3 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-xs shadow-md shadow-[#C85A32]/25 hover:scale-[1.02] transition-all text-center"
                  >
                    <Calendar className="w-3.5 h-3.5 text-amber-200" />
                    <span>Book VIP Tour</span>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
