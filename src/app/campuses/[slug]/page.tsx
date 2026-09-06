"use client";

import React, { useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { TourSchedulerModal } from "@/components/web/tour-scheduler-modal";
import { RoomVisualizer } from "@/components/web/room-visualizer";
import { CostCalculator } from "@/components/web/cost-calculator";
import {
  Building2,
  Phone,
  Calendar,
  ShieldCheck,
  CheckCircle2
} from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";
import Image from "next/image";

export default function DynamicCampusPage() {
  const params = useParams();
  const slug = params?.slug as string;

  const facility = FACILITIES.find((f) => f.slug === slug);

  const [tourModalOpen, setTourModalOpen] = useState(false);

  if (!facility) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#FAF7F2] p-4 text-center">
        <h1 className="text-2xl font-bold font-serif mb-2 text-[#1C2822]">Campus Not Found</h1>
        <p className="text-sm text-stone-600 mb-4">The requested community could not be found.</p>
        <Link href="/campuses" className="px-6 py-3 bg-[#C85A32] text-white font-bold rounded-xl text-xs">
          View All Campuses
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1C2822] font-sans">
      <WebHeader onOpenTourModal={() => setTourModalOpen(true)} />

      <main className="flex-1">
        {/* Luxury Campus Hero Section */}
        <section className="relative overflow-hidden bg-stone-950 text-white py-20 sm:py-28">
          <Image
            src={facility.image}
            alt={facility.name}
            className="absolute inset-0 w-full h-full object-cover opacity-35" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-6">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3.5 py-1 rounded-full bg-white/20 backdrop-blur-sm text-xs font-bold uppercase tracking-widest text-[#F3EFE6]">
                {facility.address.county} • {facility.address.city}, FL
              </span>
              <span className="px-3.5 py-1 rounded-full bg-emerald-500/30 text-emerald-300 text-xs font-bold border border-emerald-400/40">
                {facility.availableBeds} Suites Available for Move-In
              </span>
              <span className="px-3.5 py-1 rounded-full bg-amber-500/20 text-amber-300 text-xs font-mono">
                AHCA License #{facility.licenseNumber}
              </span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl leading-tight">
              {facility.name}
            </h1>

            <p className="text-stone-300 text-base sm:text-lg max-w-2xl leading-relaxed font-normal">
              {facility.heroDescription}
            </p>

            {/* Quick Stats Bar */}
            <div className="flex flex-wrap items-center gap-6 pt-2 text-xs sm:text-sm font-semibold">
              <div className="flex items-center gap-2">
                <Building2 className="w-4 h-4 text-[#E5A952]" />
                <span>{facility.licensedBeds} Licensed Beds</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-400" />
                <span>100% Citation-Free State Record</span>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-[#E5A952]" />
                <span>{facility.phone}</span>
              </div>
            </div>

            {/* CTA Buttons */}
            <div className="flex flex-wrap gap-4 pt-4">
              <button
                onClick={() => setTourModalOpen(true)}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-sm shadow-xl shadow-[#C85A32]/30 hover:scale-[1.02] transition-transform flex items-center gap-2"
              >
                <Calendar className="w-4 h-4 text-amber-200" />
                <span>Schedule VIP Visit & Lunch at {facility.name}</span>
              </button>

              <a
                href={`tel:${facility.phone}`}
                className="px-7 py-4 rounded-2xl bg-white/10 hover:bg-white/20 backdrop-blur-sm text-white font-bold text-sm border border-white/20 transition-colors flex items-center gap-2"
              >
                <Phone className="w-4 h-4 text-amber-300" />
                <span>Call On-Site Administrator: {facility.phone}</span>
              </a>
            </div>
          </div>
        </section>

        {/* Campus Atmosphere & Administrator Spotlight */}
        <section className="py-20 bg-white border-b border-stone-200/90">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
              {/* Highlights List (7 cols) */}
              <div className="lg:col-span-7 space-y-6">
                <div>
                  <span className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                    Campus Atmosphere & Signature Features
                  </span>
                  <h2 className="text-3xl sm:text-4xl font-bold text-[#1C2822] font-serif mt-1">
                    {facility.tagline}
                  </h2>
                </div>

                <p className="text-sm sm:text-base text-stone-700 leading-relaxed">
                  {facility.atmosphere}
                </p>

                <div className="space-y-3 pt-2">
                  {facility.highlights.map((hl, i) => (
                    <div key={i} className="flex items-start gap-3 text-xs sm:text-sm text-stone-800 font-medium">
                      <CheckCircle2 className="w-4 h-4 text-[#C85A32] shrink-0 mt-0.5" />
                      <span>{hl}</span>
                    </div>
                  ))}
                </div>

                <div className="p-5 rounded-2xl bg-[#FAF7F2] border-2 border-stone-200 text-xs text-stone-700 space-y-1">
                  <span className="font-bold text-[#1C2822] block text-sm">Chef&apos;s Signature Dining:</span>
                  <p className="leading-relaxed">{facility.diningSpecialty}</p>
                </div>
              </div>

              {/* Administrator Spotlight Card (5 cols) */}
              <div className="lg:col-span-5 bg-[#FAF7F2] p-8 rounded-3xl border-2 border-stone-200 shadow-md space-y-5">
                <div className="flex items-center gap-3.5 pb-4 border-b border-stone-200">
                  <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#C85A32] to-[#1C2822] text-white flex items-center justify-center font-bold font-serif text-xl shadow-md">
                    {facility.administrator.name.split(" ")[0][0]}
                    {facility.administrator.name.split(" ")[1] ? facility.administrator.name.split(" ")[1][0] : ""}
                  </div>
                  <div>
                    <div className="font-bold text-lg text-[#1C2822]">
                      {facility.administrator.name}
                    </div>
                    <div className="text-xs text-[#C85A32] font-bold">
                      {facility.administrator.title}
                    </div>
                  </div>
                </div>

                <p className="text-xs sm:text-sm text-stone-700 leading-relaxed italic font-serif">
                  “{facility.administrator.bio}”
                </p>

                <div className="pt-3 border-t border-stone-200 text-xs space-y-2.5">
                  <div className="flex items-center justify-between text-stone-600">
                    <span>Direct Campus Phone:</span>
                    <a href={`tel:${facility.phone}`} className="font-bold text-[#C85A32] text-sm">
                      {facility.phone}
                    </a>
                  </div>
                  <div className="flex items-center justify-between text-stone-600">
                    <span>Campus Address:</span>
                    <span className="font-semibold text-stone-800">
                      {facility.address.street}, {facility.address.city}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Interactive 3D Room Visualizer */}
        <RoomVisualizer onOpenTourModal={() => setTourModalOpen(true)} />

        {/* Cost & VA Aid Calculator */}
        <CostCalculator onOpenTourModal={() => setTourModalOpen(true)} />
      </main>

      <WebFooter />
      <StickyCareConcierge onOpenTourModal={() => setTourModalOpen(true)} />
      <TourSchedulerModal
        isOpen={tourModalOpen}
        onClose={() => setTourModalOpen(false)}
        defaultFacilityId={facility.id}
      />
    </div>
  );
}
