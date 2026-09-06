"use client";

import React, { useState } from "react";
import {
  Sparkles,
  Calendar
} from "lucide-react";
import Image from "next/image";

interface Hotspot {
  id: string;
  x: number; // percentage
  y: number; // percentage
  title: string;
  category: "safety" | "comfort" | "dignity";
  description: string;
  spec: string;
}

interface RoomVisualizerProps {
  onOpenTourModal?: () => void;
}

export function RoomVisualizer({ onOpenTourModal }: RoomVisualizerProps) {
  const [selectedSuiteType, setSelectedSuiteType] = useState<"private" | "semi-private">("private");
  const [activeHotspot, setActiveHotspot] = useState<string>("shower");

  const hotspots: Hotspot[] = [
    {
      id: "shower",
      x: 22,
      y: 28,
      title: "Zero-Barrier Roll-In Safety Shower",
      category: "safety",
      description:
        "No steps, ledges, or trip hazards. Features commercial-grade dual grab bars, a built-in fold-down teak bench, and a handheld thermostatic wand to prevent accidental scalding.",
      spec: "ADA Title III Compliant • Anti-Slip Floor Surface • Zero Step Threshold",
    },
    {
      id: "bed",
      x: 75,
      y: 35,
      title: "Personal Heirloom Bed & Quilt Setting",
      category: "comfort",
      description:
        "Residents are encouraged to bring their own familiar bed, favorite family quilts, and side tables. Our suites feature dual low-profile emergency call cords accessible from bed level.",
      spec: "Direct Bedside Call-Pendant • Soft Ambient Lighting • Whisper-Quiet AC",
    },
    {
      id: "chair",
      x: 48,
      y: 65,
      title: "Family Memory Wall & Favorite Recliner",
      category: "dignity",
      description:
        "A dedicated living nook with space for a beloved armchair, family photo galleries, and personal books. Wide windows provide natural daylight and soothing courtyard views.",
      spec: "Low-E Sunlit Windows • High-Ceiling Flow • Personal Cable & WiFi Ready",
    },
  ];

  const currentHotspot = hotspots.find((h) => h.id === activeHotspot) || hotspots[0];

  return (
    <section className="py-24 bg-white border-b border-stone-200/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#3D5A4C]/10 text-[#3D5A4C] text-xs font-bold uppercase tracking-widest mb-2">
            <Sparkles className="w-3.5 h-3.5 text-[#A94724]" />
            <span>Interactive 3D Suite & Room Studio</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C2822] font-serif">
            A Safe, Sunlit Haven of Their Own
          </h2>
          <p className="text-stone-600 text-sm sm:text-base mt-2">
            Every suite is thoughtfully crafted with wide step-free entryways, zero-threshold roll-in baths,
            and room for favorite family furniture and cherished keepsakes.
          </p>
        </div>

        {/* Room Switcher Tabs */}
        <div className="flex justify-center mb-8">
          <div className="inline-flex p-1.5 rounded-2xl bg-stone-100 border border-stone-200 shadow-inner">
            <button
              onClick={() => setSelectedSuiteType("private")}
              className={`px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                selectedSuiteType === "private"
                  ? "bg-[#1C2822] text-white shadow-md"
                  : "text-stone-700 hover:text-stone-950"
              }`}
            >
              Private Master Suite (380 sq ft)
            </button>
            <button
              onClick={() => setSelectedSuiteType("semi-private")}
              className={`px-6 py-2.5 rounded-xl text-xs sm:text-sm font-bold transition-all ${
                selectedSuiteType === "semi-private"
                  ? "bg-[#1C2822] text-white shadow-md"
                  : "text-stone-700 hover:text-stone-950"
              }`}
            >
              Companion Suite (450 sq ft)
            </button>
          </div>
        </div>

        {/* Visual Studio Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left: Interactive Room Blueprint (7 cols) */}
          <div className="lg:col-span-7 bg-[#FAF7F2] rounded-3xl p-6 sm:p-8 border-2 border-stone-200 relative min-h-[440px] flex flex-col justify-between shadow-inner">
            <div className="flex items-center justify-between text-xs text-stone-600 pb-3 border-b border-stone-200">
              <span className="font-bold text-[#1C2822]">Interactive Suite Studio</span>
              <span>Click any pulsating pin to inspect safety specs</span>
            </div>

            {/* Room Canvas Area */}
            <div className="relative h-72 sm:h-80 w-full my-4 rounded-2xl overflow-hidden bg-stone-900 shadow-md">
              <Image
                src={
                  selectedSuiteType === "private"
                    ? "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1000&q=80"
                    : "https://images.unsplash.com/photo-1595526114035-0d45ed16cfbf?auto=format&fit=crop&w=1000&q=80"
                }
                alt="Circle of Life Suite Interior"
                className="w-full h-full object-cover opacity-85" unoptimized loading="eager" fill sizes="100vw"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-stone-950/60 via-transparent to-transparent" />

              {/* Pulsating Hotspot Pins */}
              {hotspots.map((spot) => (
                <button
                  key={spot.id}
                  onClick={() => setActiveHotspot(spot.id)}
                  style={{ top: `${spot.y}%`, left: `${spot.x}%` }}
                  className={`absolute -translate-x-1/2 -translate-y-1/2 z-20 group focus:outline-none`}
                >
                  <div
                    className={`w-9 h-9 rounded-full flex items-center justify-center transition-all ${
                      activeHotspot === spot.id
                        ? "bg-[#B34E28] text-white scale-125 ring-4 ring-white shadow-xl"
                        : "bg-white/90 text-[#1C2822] hover:scale-110 shadow-md"
                    }`}
                  >
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <span className="absolute left-1/2 -translate-x-1/2 top-10 whitespace-nowrap px-2.5 py-1 rounded-full bg-[#1C2822]/90 backdrop-blur-sm text-white text-[10px] font-bold opacity-0 group-hover:opacity-100 transition-opacity shadow-sm">
                    {spot.title}
                  </span>
                </button>
              ))}
            </div>

            {/* Quick Feature Badges Bar */}
            <div className="grid grid-cols-3 gap-2 pt-3 border-t border-stone-200 text-center text-xs">
              <div className="p-2.5 rounded-xl bg-white border border-stone-200">
                <span className="font-bold text-[#1C2822] block">Single Story</span>
                <span className="text-[11px] text-stone-600">Zero Elevators</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-stone-200">
                <span className="font-bold text-[#1C2822] block">Full Privacy</span>
                <span className="text-[11px] text-stone-600">Private Bathroom</span>
              </div>
              <div className="p-2.5 rounded-xl bg-white border border-stone-200">
                <span className="font-bold text-[#1C2822] block">Pet Friendly</span>
                <span className="text-[11px] text-stone-600">Bring Small Pets</span>
              </div>
            </div>
          </div>

          {/* Right: Selected Feature Details (5 cols) */}
          <div className="lg:col-span-5 bg-[#FAF7F2] p-8 rounded-3xl border-2 border-stone-200 shadow-sm space-y-6">
            <div>
              <span className="text-xs font-bold uppercase tracking-widest text-[#A94724]">
                Architectural Safety Specification
              </span>
              <h3 className="text-2xl font-bold text-[#1C2822] font-serif mt-1">
                {currentHotspot.title}
              </h3>
            </div>

            <p className="text-sm text-stone-700 leading-relaxed">
              {currentHotspot.description}
            </p>

            <div className="p-4 rounded-2xl bg-white border border-stone-200 space-y-1.5 shadow-2xs">
              <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600">
                Engineering Standard:
              </div>
              <div className="text-xs font-semibold text-[#3D5A4C]">
                {currentHotspot.spec}
              </div>
            </div>

            <div className="pt-2">
              <button
                onClick={onOpenTourModal}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] hover:scale-[1.01] active:scale-[0.99] text-white font-bold text-xs shadow-lg shadow-[#C85A32]/25 transition-all flex items-center justify-center gap-2"
              >
                <Calendar className="w-4 h-4 text-amber-200" />
                <span>Tour Available Suites in Person</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
