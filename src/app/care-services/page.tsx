"use client";

import React, { useState } from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { TourSchedulerModal } from "@/components/web/tour-scheduler-modal";
import { DayInTheLife } from "@/components/web/day-in-the-life";
import { DiningExperience } from "@/components/web/dining-experience";
import {
  Heart,
  CheckCircle2,
  Phone
} from "lucide-react";
import { CARE_LEVELS } from "@/lib/data/pricing-data";
import Image from "next/image";

export default function CareServicesPage() {
  const [tourModalOpen, setTourModalOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1C2822] font-sans">
      <WebHeader onOpenTourModal={() => setTourModalOpen(true)} />

      <main className="flex-1">
        {/* Luxury Atmospheric Hero Banner */}
        <section className="relative overflow-hidden bg-stone-950 text-white py-20 sm:py-28">
          <Image
            src="https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?auto=format&fit=crop&w=1600&q=80"
            alt="Loving Care at Circle of Life"
            className="absolute inset-0 w-full h-full object-cover opacity-30" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-300/30">
              <Heart className="w-3.5 h-3.5 text-[#C85A32] fill-[#C85A32]" />
              <span>Dignity-Centered Care Services</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl mx-auto leading-tight">
              Care That Honors Their Dignity & Story
            </h1>

            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal">
              We never reduce human beings to clinical checklists or room numbers. From gentle morning
              medications to scratch-made Southern meals and afternoon hymn singing, our care is loving,
              attentive, and around the clock.
            </p>

            <div className="flex flex-wrap justify-center gap-4 pt-4">
              <button
                onClick={() => setTourModalOpen(true)}
                className="px-8 py-4 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-sm shadow-xl shadow-[#C85A32]/30 hover:scale-[1.02] transition-transform"
              >
                Schedule a Consultation & Lunch
              </button>
              <a
                href="tel:3864060887"
                className="px-7 py-4 rounded-2xl bg-white/10 hover:bg-white/20 backdrop-blur-md text-white font-bold text-sm border border-white/20 transition-colors flex items-center gap-2"
              >
                <Phone className="w-4 h-4 text-amber-300" />
                <span>Call 24/7: (386) 406-0887</span>
              </a>
            </div>
          </div>
        </section>

        {/* 2 Core Pathways: Standard Assisted Living vs Respite */}
        <section className="py-20 bg-white border-b border-stone-200/90">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <span className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                Tailored Care Options
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#1C2822] font-serif mt-1">
                Two Compassionate Care Pathways
              </h2>
              <p className="text-stone-600 text-sm sm:text-base mt-2">
                Whether you need a permanent loving home for mom or a short-term respite stay to recharge,
                we provide the exact level of personalized care required.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-10">
              {/* Card 1: Standard Assisted Living */}
              <div className="rounded-3xl bg-[#FAF7F2] border-2 border-stone-200 shadow-md hover:shadow-xl transition-all overflow-hidden flex flex-col justify-between">
                <div className="relative h-64 w-full bg-stone-900">
                  <Image
                    src="https://images.unsplash.com/photo-1586105251261-72a756497a11?auto=format&fit=crop&w=1000&q=80"
                    alt="Standard Assisted Living"
                    className="w-full h-full object-cover" unoptimized loading="eager" fill sizes="100vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-transparent to-transparent" />
                  <div className="absolute top-4 left-4 px-3.5 py-1 rounded-full bg-[#C85A32] text-white text-xs font-bold shadow-sm">
                    Long-Term Sanctuary
                  </div>
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <h3 className="text-2xl font-bold font-serif">Standard 24-Hour Assisted Living</h3>
                  </div>
                </div>

                <div className="p-7 space-y-5 flex-1 flex flex-col justify-between">
                  <p className="text-sm text-stone-700 leading-relaxed">
                    For seniors who desire the comfort of their own private suite while enjoying 24-hour
                    hands-on assistance with dressing, bathing, medications, and delicious dining.
                  </p>

                  <div className="space-y-2.5 text-xs sm:text-sm text-stone-800 font-medium">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>Certified 24/7 Medication Administration (eMAR safety)</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>Three scratch-made Southern meals daily + snacks & hydration</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>Daily housekeeping, fresh linens & personal laundry</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>Life enrichment: gardening, gospel hymns, dominoes, country outings</span>
                    </div>
                  </div>

                  <div className="pt-5 border-t border-stone-200 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-stone-400 block uppercase tracking-wider font-semibold">
                        All-Inclusive Rates From
                      </span>
                      <span className="text-2xl font-bold text-[#C85A32] font-serif">$4,000 / mo</span>
                    </div>
                    <button
                      onClick={() => setTourModalOpen(true)}
                      className="px-6 py-3 rounded-xl bg-[#C85A32] hover:bg-[#B34E28] text-white font-bold text-xs shadow-md transition-colors"
                    >
                      Book a Private Tour
                    </button>
                  </div>
                </div>
              </div>

              {/* Card 2: Caregiver Respite & Recovery */}
              <div className="rounded-3xl bg-[#FAF7F2] border-2 border-stone-200 shadow-md hover:shadow-xl transition-all overflow-hidden flex flex-col justify-between">
                <div className="relative h-64 w-full bg-stone-900">
                  <Image
                    src="https://images.unsplash.com/photo-1540518614846-7ede433c4ef7?auto=format&fit=crop&w=1000&q=80"
                    alt="Caregiver Respite Stay"
                    className="w-full h-full object-cover" unoptimized loading="eager" fill sizes="100vw"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-stone-950/80 via-transparent to-transparent" />
                  <div className="absolute top-4 left-4 px-3.5 py-1 rounded-full bg-[#1C2822] text-white text-xs font-bold shadow-sm">
                    Short-Stay & Recovery
                  </div>
                  <div className="absolute bottom-4 left-4 right-4 text-white">
                    <h3 className="text-2xl font-bold font-serif">Caregiver Respite & Hospital Recovery</h3>
                  </div>
                </div>

                <div className="p-7 space-y-5 flex-1 flex flex-col justify-between">
                  <p className="text-sm text-stone-700 leading-relaxed">
                    Giving family caregivers the opportunity to rest, travel, or recover from burnout,
                    or providing a safe stepping-stone for a loved one discharged from the hospital.
                  </p>

                  <div className="space-y-2.5 text-xs sm:text-sm text-stone-800 font-medium">
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>Fully furnished private suites ready for immediate same-day move-in</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>Seamless medication transfer with local pharmacy partners</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>All dining, housekeeping, and social activities included</span>
                    </div>
                    <div className="flex items-start gap-2.5">
                      <CheckCircle2 className="w-4 h-4 text-[#3D5A4C] shrink-0 mt-0.5" />
                      <span>Flexible terms: from one week to multiple months</span>
                    </div>
                  </div>

                  <div className="pt-5 border-t border-stone-200 flex items-center justify-between">
                    <div>
                      <span className="text-[11px] text-stone-400 block uppercase tracking-wider font-semibold">
                        Availability
                      </span>
                      <span className="text-xl font-bold text-[#3D5A4C] font-serif">Immediate Move-In</span>
                    </div>
                    <a
                      href="tel:3864060887"
                      className="px-6 py-3 rounded-xl bg-[#1C2822] hover:bg-stone-800 text-white font-bold text-xs shadow-md transition-colors"
                    >
                      Call: (386) 406-0887
                    </a>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Predictable Care Level ADL Matrix */}
        <section className="py-20 bg-[#FAF7F2] border-b border-stone-200/90">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <span className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                Honest, Tier-Free Transparency
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#1C2822] font-serif mt-1">
                How Our Care Tiers Work
              </h2>
              <p className="text-stone-600 text-sm sm:text-base mt-2">
                We evaluate 8 functional categories to assign a clear, predictable care score.
                No sudden fee spikes or surprise nursing invoices.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              {CARE_LEVELS.map((level) => (
                <div
                  key={level.id}
                  className="p-6 rounded-3xl bg-white border border-stone-200 shadow-sm space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold px-3 py-1 rounded-full bg-stone-100 text-stone-700">
                        {level.tier}
                      </span>
                      <span className="font-bold text-sm text-[#C85A32]">
                        {level.monthlyFee === 0 ? "Included ($0)" : `+$${level.monthlyFee}/mo`}
                      </span>
                    </div>
                    <h3 className="font-bold text-base text-[#1C2822] font-serif">{level.name}</h3>
                    <p className="text-xs text-stone-600 leading-relaxed">{level.description}</p>
                  </div>

                  <div className="pt-3 border-t border-stone-100 space-y-1.5 text-[11px] text-[#3D5A4C] font-medium">
                    {level.includedServices.map((srv, idx) => (
                      <div key={idx} className="flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-[#C85A32] shrink-0" />
                        <span>{srv}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Day in the Life Sun-Slider & Dining Table */}
        <DayInTheLife />
        <DiningExperience onOpenTourModal={() => setTourModalOpen(true)} />
      </main>

      <WebFooter />
      <StickyCareConcierge onOpenTourModal={() => setTourModalOpen(true)} />
      <TourSchedulerModal isOpen={tourModalOpen} onClose={() => setTourModalOpen(false)} />
    </div>
  );
}
