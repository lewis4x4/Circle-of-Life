"use client";

import React from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { BuilderStory } from "@/components/web/builder-story";
import { Award } from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";
import Image from "next/image";

export default function AboutPage() {
  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1C2822] font-sans">
      <WebHeader />

      <main className="flex-1">
        {/* Luxury Hero Banner */}
        <section className="relative overflow-hidden bg-stone-950 text-white py-20 sm:py-28">
          <Image
            src="https://images.unsplash.com/photo-1541888946425-d0fbb18f15f7?auto=format&fit=crop&w=1600&q=80"
            alt="Craftsmanship in North Florida"
            className="absolute inset-0 w-full h-full object-cover opacity-25" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-300/30">
              <Award className="w-3.5 h-3.5 text-[#C85A32]" />
              <span>50 Years of North Florida Craftsmanship</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl mx-auto leading-tight">
              Our Story, Our Craft & Our Sacred Promise
            </h1>
            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal">
              We are not a Wall Street private-equity investment conglomerate. We are local builders
              and dedicated caregivers who believe our elders deserve a life filled with dignity, love, and wonder.
            </p>
          </div>
        </section>

        {/* The Non-Institutional Doctrine */}
        <section className="py-20 bg-white border-b border-stone-200/90">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <span className="text-xs font-bold uppercase tracking-widest text-[#C85A32]">
              The Circle of Life Mission
            </span>
            <blockquote className="text-2xl sm:text-3xl font-serif text-[#1C2822] leading-relaxed italic border-y-2 border-[#C85A32]/30 py-8 px-4">
              “Our commitment is to provide non-institutional community retirement living.
              We believe this commitment allows our residents to age in place with dignity,
              purpose, meaning, value, significance, love, joy, peace, security, hope, and wonder.”
            </blockquote>
          </div>
        </section>

        {/* Builder Story Component */}
        <BuilderStory />

        {/* Leadership & On-Site Executive Directors */}
        <section className="py-24 bg-white border-b border-stone-200/90">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center max-w-3xl mx-auto mb-14">
              <span className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                On-Site Leadership
              </span>
              <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C2822] font-serif mt-1">
                Meet the Executive Directors Who Guide Our Homes
              </h2>
              <p className="text-stone-600 text-sm sm:text-base mt-2">
                Our Executive Directors are on the floor every day, knowing every resident&apos;s name,
                                              favorite hymns, family stories, and personalized daily routines.
                                            </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
              {FACILITIES.map((f) => (
                <div
                  key={f.id}
                  className="p-7 rounded-3xl bg-[#FAF7F2] border-2 border-stone-200 shadow-sm space-y-5 flex flex-col justify-between"
                >
                  <div className="space-y-4">
                    <div className="flex items-center gap-3.5">
                      <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#C85A32] to-[#1C2822] text-white flex items-center justify-center font-bold font-serif text-xl shadow-md">
                        {f.administrator.name.split(" ")[0][0]}
                        {f.administrator.name.split(" ")[1] ? f.administrator.name.split(" ")[1][0] : ""}
                      </div>
                      <div>
                        <div className="font-bold text-base text-[#1C2822]">{f.administrator.name}</div>
                        <div className="text-xs text-[#C85A32] font-bold mt-0.5">{f.name}</div>
                      </div>
                    </div>

                    <p className="text-xs sm:text-sm text-stone-700 leading-relaxed italic font-serif">
                      “{f.administrator.bio}”
                    </p>
                  </div>

                  <div className="pt-3 border-t border-stone-200 text-xs flex items-center justify-between">
                    <span className="text-stone-500">Direct Campus Phone:</span>
                    <a href={`tel:${f.phone}`} className="font-bold text-[#1C2822] hover:text-[#C85A32]">
                      {f.phone}
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <WebFooter />
      <StickyCareConcierge />
    </div>
  );
}
