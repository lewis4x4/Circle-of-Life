"use client";

import React from "react";
import Link from "next/link";
import {
  Heart,
  Calendar,
  DollarSign,
  ShieldCheck,
  Award,
  Sparkles,
  Star,
} from "lucide-react";
import Image from "next/image";

interface HeroSectionProps {
  onOpenTourModal?: () => void;
}

export function HeroSection({ onOpenTourModal }: HeroSectionProps) {
  return (
    <section className="relative overflow-hidden bg-[#FAF7F2] pt-6 pb-24 lg:pt-12 lg:pb-32">
      {/* Background Atmosphere: Dappled Florida Sunlight & Soft Warm Gradients */}
      <div
        className="pointer-events-none absolute inset-0 z-0 opacity-40 bg-[radial-gradient(ellipse_90%_70%_at_50%_-15%,rgba(200,90,50,0.18),transparent_65%),radial-gradient(ellipse_70%_60%_at_95%_25%,rgba(28,40,34,0.12),transparent_55%)]"
        aria-hidden
      />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Trust Ribbon */}
        <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 sm:gap-3 mb-8">
          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-[#1C2822] text-[#F3EFE6] text-xs font-bold tracking-wide shadow-sm border border-stone-700">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <span>100% AHCA State Citation-Free Record</span>
          </div>
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#1C2822] text-xs font-bold border border-stone-300 shadow-xs">
            <Award className="w-3.5 h-3.5 text-[#A94724]" />
            <span>50-Year Master Builder Heritage</span>
          </div>
          <div className="hidden sm:inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white text-[#3D5A4C] text-xs font-bold border border-stone-300 shadow-xs">
            <Heart className="w-3.5 h-3.5 text-[#A94724] fill-[#C85A32]/20" />
            <span>5 North Florida Sanctuaries • 258 Beds</span>
          </div>
        </div>

        {/* 2-Column Main Hero Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 lg:gap-10 items-center">
          {/* Left Column: Emotionally Moving Typography (7 cols) */}
          <div className="lg:col-span-7 space-y-6 text-left">
            <h1 className="text-4xl sm:text-5xl lg:text-6xl xl:text-[68px] font-extrabold tracking-tight text-[#1C2822] font-serif leading-[1.12]">
              Where dignity thrives, and you can be{" "}
              <span className="italic font-serif text-[#A94724] underline decoration-amber-300/40 decoration-wavy decoration-2">
                their child
              </span>{" "}
              again.
            </h1>

            <p className="text-base sm:text-lg lg:text-xl text-stone-700 font-normal leading-relaxed max-w-2xl">
              You’ve carried the sleepless nights, worry, and caregiving exhaustion for far too long.
              At Circle of Life, we embrace your loved ones in 24-hour attentive warmth, scratch-made Southern meals,
              and shaded live oak verandas—giving your family back peace of mind.
            </p>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 pt-2">
              <Link
                href="/tour"
                onClick={onOpenTourModal}
                className="inline-flex items-center justify-center gap-2.5 px-8 py-4.5 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-base shadow-xl shadow-[#C85A32]/30 hover:scale-[1.02] active:scale-[0.98] transition-all border border-amber-200/30"
              >
                <Calendar className="w-5 h-5 text-amber-200" />
                <span>Schedule a Private Tour & Lunch</span>
              </Link>

              <Link
                href="/pricing"
                className="inline-flex items-center justify-center gap-2 px-7 py-4.5 rounded-2xl bg-white text-[#1C2822] font-bold text-base border-2 border-stone-300 hover:border-[#1C2822] hover:bg-stone-50 transition-all shadow-sm"
              >
                <DollarSign className="w-5 h-5 text-[#3D5A4C]" />
                <span>Explore Transparent Pricing</span>
              </Link>
            </div>

            {/* Family Review Social Proof Micro-Strip */}
            <div className="pt-4 flex items-center gap-4 border-t border-stone-200/90 text-xs text-stone-600">
              <div className="flex -space-x-2">
                <Image
                  src="https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=80&q=80"
                  alt="Reviewer"
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-white" unoptimized loading="eager" width={32} height={32}
                />
                <Image
                  src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=80&q=80"
                  alt="Reviewer"
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-white" unoptimized loading="eager" width={32} height={32}
                />
                <Image
                  src="https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=80&q=80"
                  alt="Reviewer"
                  className="w-8 h-8 rounded-full object-cover ring-2 ring-white" unoptimized loading="eager" width={32} height={32}
                />
              </div>
              <div>
                <div className="flex items-center gap-1 text-amber-500 font-bold">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
                  ))}
                  <span className="text-[#1C2822] ml-1">4.9 / 5.0 Rating</span>
                </div>
                <div className="text-[11px] text-stone-600">From 140+ North Florida families</div>
              </div>
            </div>
          </div>

          {/* Right Column: Hero Visual Masterpiece Card (5 cols) */}
          <div className="lg:col-span-5">
            <div className="relative rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-stone-900">
              <Image
                src="https://images.unsplash.com/photo-1544027993-37dbfe43562a?auto=format&fit=crop&w=1000&q=80"
                alt="Southern Porch Living at Circle of Life"
                className="w-full h-[460px] object-cover" unoptimized loading="eager" width={1000} height={460}
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/90 via-stone-950/30 to-transparent" />

              {/* Floating Quote Badge on Image */}
              <div className="absolute top-4 left-4 right-4 bg-white/90 backdrop-blur-md p-3.5 rounded-2xl border border-stone-200/80 shadow-md">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold text-[#1C2822] flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-[#A94724]" />
                    Featured Flagship Community
                  </span>
                  <span className="text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full text-[10px]">
                    2 Suites Available
                  </span>
                </div>
                <div className="font-serif font-bold text-sm text-[#1C2822] mt-1">
                  The Plantation on Summers
                </div>
                <div className="text-[11px] text-stone-600">1478 W Summers Lane, Lake City, FL</div>
              </div>

              {/* Bottom Image Overlay Bar */}
              <div className="absolute bottom-4 left-4 right-4 text-white space-y-3">
                <div className="p-3.5 rounded-2xl bg-[#1C2822]/90 backdrop-blur-md border border-stone-700 text-xs space-y-1">
                  <div className="text-amber-300 font-bold text-[11px] uppercase tracking-wider">
                    The Southern Porch Promise
                  </div>
                  <p className="text-stone-200 italic font-serif leading-snug">
                    “Single-story craftsmanship, rocking chairs under the live oaks, and staff who know his name and his stories.”
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <Link
                    href="/campuses/plantation-summers-lake-city"
                    className="py-2.5 px-3 rounded-xl bg-white text-[#1C2822] font-bold text-xs text-center hover:bg-stone-100 transition-colors"
                  >
                    Explore Plantation
                  </Link>
                  <Link
                    href="/campuses"
                    className="py-2.5 px-3 rounded-xl bg-[#B34E28] text-white font-bold text-xs text-center hover:bg-[#B34E28] transition-colors"
                  >
                    View All 5 Homes
                  </Link>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
