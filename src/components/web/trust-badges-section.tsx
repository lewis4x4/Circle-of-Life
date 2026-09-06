"use client";

import React from "react";
import { ShieldCheck, UserCheck, Pill, Zap, Award } from "lucide-react";

export function TrustBadgesSection() {
  const trustPoints = [
    {
      icon: ShieldCheck,
      title: "100% Citation-Free AHCA Record",
      badge: "State of Florida Verified",
      description:
        "Zero deficiency citations across all 5 facilities in official Florida Agency for Health Care Administration unannounced surveys.",
      bgStyle: "bg-emerald-950/5 border-emerald-500/30 text-emerald-950",
      iconStyle: "text-emerald-700 bg-emerald-100",
    },
    {
      icon: UserCheck,
      title: "100% Level 2 FBI Screened Staff",
      badge: "F.S. 435.04 Compliance",
      description:
        "Every single caregiver and executive director completes comprehensive FBI, FDLE, and Florida AHCA Clearinghouse background clearances.",
      bgStyle: "bg-blue-950/5 border-blue-500/30 text-blue-950",
      iconStyle: "text-blue-700 bg-blue-100",
    },
    {
      icon: Pill,
      title: "24/7 Certified Medication eMAR",
      badge: "6-Rights Safety",
      description:
        "Electronic medication administration records synchronized daily with Baya & North Florida Pharmacy for zero-error assurance.",
      bgStyle: "bg-amber-950/5 border-amber-500/30 text-amber-950",
      iconStyle: "text-amber-700 bg-amber-100",
    },
    {
      icon: Zap,
      title: "Commercial Emergency Generators",
      badge: "F.A.C. 59A-36 Ready",
      description:
        "On-site dual-fuel LP generators and automatic grid switches ensure 100% continuous air conditioning, refrigeration, and safety during storms.",
      bgStyle: "bg-stone-900/5 border-stone-400/40 text-stone-900",
      iconStyle: "text-stone-700 bg-stone-200",
    },
  ];

  return (
    <section className="py-16 bg-white border-y border-stone-200/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto mb-12">
          <div className="inline-flex items-center gap-1.5 px-3.5 py-1 rounded-full bg-[#3D5A4C]/10 text-[#3D5A4C] text-xs font-bold uppercase tracking-widest mb-2">
            <Award className="w-3.5 h-3.5 text-[#A94724]" />
            <span>The Circle of Life Gold Standard</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1C2822] font-serif">
            Uncompromising Safety, Proven Regulatory Perfection
          </h2>
          <p className="text-stone-600 text-sm sm:text-base mt-2">
            While commercial corporate chains frequently receive state citations, Circle of Life maintains
            an unbroken standard of zero deficiency findings and hands-on accountability.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {trustPoints.map((point, index) => {
            const Icon = point.icon;
            return (
              <div
                key={index}
                className={`p-7 rounded-3xl border ${point.bgStyle} shadow-xs hover:shadow-lg transition-all duration-300 flex flex-col justify-between`}
              >
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <div className={`p-3.5 rounded-2xl ${point.iconStyle} shadow-xs`}>
                      <Icon className="w-6 h-6" />
                    </div>
                    <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-0.5 rounded-full bg-white border border-stone-200 text-stone-700 shadow-2xs">
                      {point.badge}
                    </span>
                  </div>
                  <h3 className="font-bold text-base text-[#1C2822] font-serif mb-2">{point.title}</h3>
                  <p className="text-xs text-stone-600 leading-relaxed">{point.description}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
