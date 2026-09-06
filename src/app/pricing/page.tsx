"use client";

import React, { useState } from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { TourSchedulerModal } from "@/components/web/tour-scheduler-modal";
import { CostCalculator } from "@/components/web/cost-calculator";
import { DollarSign } from "lucide-react";
import { FINANCIAL_OFFSETS } from "@/lib/data/pricing-data";
import Image from "next/image";

export default function PricingPage() {
  const [tourModalOpen, setTourModalOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1C2822] font-sans">
      <WebHeader onOpenTourModal={() => setTourModalOpen(true)} />

      <main className="flex-1">
        {/* Luxury Hero Banner */}
        <section className="relative overflow-hidden bg-stone-950 text-white py-20 sm:py-28">
          <Image
            src="https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1600&q=80"
            alt="Transparent Senior Living Pricing"
            className="absolute inset-0 w-full h-full object-cover opacity-25" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-300/30">
              <DollarSign className="w-3.5 h-3.5 text-[#C85A32]" />
              <span>100% Transparent Financial Guidance</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl mx-auto leading-tight">
              Simple, Predictable All-Inclusive Living
            </h1>
            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal">
              We believe families deserve honest, transparent pricing without hidden tier spikes,
              entrance community fees, or surprise monthly nursing add-ons.
            </p>
          </div>
        </section>

        {/* Cost Calculator Component */}
        <CostCalculator onOpenTourModal={() => setTourModalOpen(true)} />

        {/* VA Aid & Attendance Benefits */}
        <section className="py-20 bg-white border-b border-stone-200/90">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <span className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                Honoring Those Who Served
              </span>
              <h2 className="text-3xl sm:text-4xl font-bold text-[#1C2822] font-serif mt-1">
                VA Aid & Attendance Pension Offsets
              </h2>
              <p className="text-stone-600 text-sm sm:text-base mt-2">
                If your parent is a wartime veteran or the surviving spouse of a wartime veteran,
                the Veterans Administration provides significant monthly tax-free pensions to offset assisted living costs.
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {FINANCIAL_OFFSETS.map((offset) => (
                <div
                  key={offset.id}
                  className="p-7 rounded-3xl bg-[#FAF7F2] border-2 border-stone-200 shadow-sm space-y-4 flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="text-3xl font-bold font-serif text-[#C85A32]">
                      ${offset.monthlySavings.toLocaleString()}
                      <span className="text-xs text-stone-500 font-sans font-normal"> / mo</span>
                    </div>
                    <h3 className="font-bold text-base text-[#1C2822]">{offset.name}</h3>
                    <p className="text-xs text-stone-600 leading-relaxed">{offset.description}</p>
                  </div>

                  <div className="p-3.5 bg-white rounded-2xl border border-stone-200 text-xs text-[#3D5A4C] font-semibold">
                    {offset.qualifyingDetails}
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-12 p-8 rounded-3xl bg-[#1C2822] text-white max-w-3xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-6 shadow-xl border border-stone-700">
              <div className="space-y-1 text-center sm:text-left">
                <div className="font-bold text-base font-serif">Need assistance applying for VA benefits?</div>
                <div className="text-xs text-stone-300">
                  Our on-site administrative staff helps North Florida families with application paperwork at no cost.
                </div>
              </div>
              <a
                href="tel:3864060887"
                className="px-6 py-3.5 rounded-xl bg-[#C85A32] hover:bg-[#B34E28] text-white font-bold text-xs shrink-0 transition-colors shadow-md"
              >
                Call for VA Guidance: (386) 406-0887
              </a>
            </div>
          </div>
        </section>
      </main>

      <WebFooter />
      <StickyCareConcierge onOpenTourModal={() => setTourModalOpen(true)} />
      <TourSchedulerModal isOpen={tourModalOpen} onClose={() => setTourModalOpen(false)} />
    </div>
  );
}
