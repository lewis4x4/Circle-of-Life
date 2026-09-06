"use client";

import React, { useState } from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { TourSchedulerModal } from "@/components/web/tour-scheduler-modal";
import { AssessmentQuizWidget } from "@/components/web/assessment-quiz-widget";
import { HelpCircle } from "lucide-react";
import Image from "next/image";

export default function AssessmentQuizPage() {
  const [tourModalOpen, setTourModalOpen] = useState(false);

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1C2822] font-sans">
      <WebHeader onOpenTourModal={() => setTourModalOpen(true)} />

      <main className="flex-1">
        {/* Luxury Hero Banner */}
        <section className="relative overflow-hidden bg-stone-950 text-white py-20 sm:py-28">
          <Image
            src="https://images.unsplash.com/photo-1576765608535-5f04d1e3f289?auto=format&fit=crop&w=1600&q=80"
            alt="Loving Care Assessment"
            className="absolute inset-0 w-full h-full object-cover opacity-25" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-300/30">
              <HelpCircle className="w-3.5 h-3.5 text-[#C85A32]" />
              <span>Confidential Clinical Assessment</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl mx-auto leading-tight">
              Is It Time for Assisted Living?
            </h1>
            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal">
              Caregiver exhaustion is real. Take 60 seconds to objectively evaluate your loved one&apos;s
                                        medication safety, nutrition, and daily support needs.
                                      </p>
          </div>
        </section>

        {/* Assessment Quiz Component */}
        <AssessmentQuizWidget onOpenTourModal={() => setTourModalOpen(true)} />
      </main>

      <WebFooter />
      <StickyCareConcierge onOpenTourModal={() => setTourModalOpen(true)} />
      <TourSchedulerModal isOpen={tourModalOpen} onClose={() => setTourModalOpen(false)} />
    </div>
  );
}
