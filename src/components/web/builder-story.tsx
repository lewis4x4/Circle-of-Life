"use client";

import React from "react";
import Link from "next/link";
import { Hammer, CheckCircle2, ArrowRight } from "lucide-react";
import Image from "next/image";

export function BuilderStory() {
  return (
    <section className="py-24 bg-[#FAF7F2] border-b border-stone-200/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Image with Luxury Badge (5 cols) */}
          <div className="lg:col-span-5 relative">
            <div className="rounded-3xl overflow-hidden shadow-2xl border-4 border-white bg-stone-900">
              <Image
                src="https://images.unsplash.com/photo-1541888946425-d0fbb18f15f7?auto=format&fit=crop&w=1000&q=80"
                alt="Master Craftsmanship in North Florida"
                className="w-full h-88 sm:h-96 object-cover" unoptimized loading="eager" width={1000} height={384}
              />
            </div>

            {/* Floating Badge */}
            <div className="absolute -bottom-6 -right-4 sm:bottom-6 sm:-right-6 bg-[#1C2822] text-white p-6 rounded-3xl shadow-2xl border border-stone-700 max-w-[260px]">
              <div className="text-[#E5A952] font-bold text-3xl font-serif">50+ Years</div>
              <div className="text-xs text-stone-300 mt-1 leading-snug">
                Of master builder craftsmanship and non-institutional integrity in North Florida.
              </div>
            </div>
          </div>

          {/* Right Column: Narrative (7 cols) */}
          <div className="lg:col-span-7 space-y-6">
            <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#3D5A4C]/10 text-[#3D5A4C] text-xs font-bold uppercase tracking-widest">
              <Hammer className="w-3.5 h-3.5 text-[#A94724]" />
              <span>The Builder&apos;s Promise • GSMS Developers</span>
            </div>

            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C2822] font-serif leading-tight">
              Built with Love. Designed to Feel Like Home, Not an Institution.
            </h2>

            <p className="text-stone-700 text-sm sm:text-base leading-relaxed">
              When founder Milton Smith and GSMS Developers built these five communities across
              Lafayette, Suwannee, and Columbia counties, they refused to build standard commercial facilities.
              Every building was custom-crafted with a single guiding question:{" "}
              <em className="text-[#A94724] font-serif font-bold">“Would this be good enough for my own mother?”</em>
            </p>

            {/* Craftsmanship Pillars */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-2">
              <div className="p-5 rounded-2xl bg-white border border-stone-200 shadow-xs space-y-1.5">
                <div className="font-bold text-sm text-[#1C2822] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#3D5A4C]" />
                  <span>100% Single-Story Design</span>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Zero confusing elevators, stairs, or ramps. Wide, safe, step-free hallways throughout.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-stone-200 shadow-xs space-y-1.5">
                <div className="font-bold text-sm text-[#1C2822] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#3D5A4C]" />
                  <span>Wide Sunlit Porches</span>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Screened verandas with cedar rocking chairs, fans, and views of live oaks and songbirds.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-stone-200 shadow-xs space-y-1.5">
                <div className="font-bold text-sm text-[#1C2822] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#3D5A4C]" />
                  <span>Step-Free Roll-In Baths</span>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Zero-barrier safety walk-in showers with reinforced grab bars and non-slip tile floors.
                </p>
              </div>

              <div className="p-5 rounded-2xl bg-white border border-stone-200 shadow-xs space-y-1.5">
                <div className="font-bold text-sm text-[#1C2822] flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-[#3D5A4C]" />
                  <span>Commercial Storm Backup</span>
                </div>
                <p className="text-xs text-stone-600 leading-relaxed">
                  Commercial automatic dual-fuel LP generators guaranteeing continuous AC and lighting.
                </p>
              </div>
            </div>

            <div className="pt-2">
              <Link
                href="/about"
                className="inline-flex items-center gap-2 font-bold text-sm text-[#A94724] hover:text-[#B34E28] transition-colors group"
              >
                <span>Read the Complete 50-Year Craftsmanship Story</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
