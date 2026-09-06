"use client";

import React, { useState } from "react";
import Link from "next/link";
import { MapPin, Navigation, Phone, ArrowRight, Car } from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";

export function RegionalMap() {
  const [selectedPin, setSelectedPin] = useState<string>("plantation");

  const activeFacility = FACILITIES.find((f) => f.id === selectedPin) || FACILITIES[0];

  const driveTimes = [
    { from: "Lake City, FL", to: "Plantation / Grande Cypress", time: "Local (5–10 min)" },
    { from: "Live Oak, FL", to: "Rising Oaks ALF", time: "Local (5 min)" },
    { from: "Mayo, FL", to: "Oakridge / Homewood", time: "Local (3–5 min)" },
    { from: "Gainesville / UF Health", to: "Lake City Campuses", time: "42 min via I-75 N" },
    { from: "Tallahassee, FL", to: "Mayo Campuses", time: "1 hr 10 min via US-27" },
    { from: "Jacksonville, FL", to: "Lake City Campuses", time: "1 hr 12 min via I-10 W" },
    { from: "Valdosta, GA", to: "Live Oak / Lake City", time: "45 min via I-75 S" },
  ];

  return (
    <section className="py-20 bg-white border-b border-stone-200/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#3d5a4c]/10 text-[#3d5a4c] text-xs font-bold uppercase tracking-wider mb-2">
            <Navigation className="w-3.5 h-3.5" />
            <span>North Florida Regional Cartography</span>
          </div>
          <h2 className="text-3xl sm:text-4xl font-bold text-[#1e2b24] font-serif">
            Conveniently Close to Healthcare, Peaceful Country Setting
          </h2>
          <p className="text-stone-600 text-sm sm:text-base mt-2">
            Our 5 campuses are strategically situated throughout Lafayette, Suwannee, and Columbia
            counties—minutes from regional hospitals, medical centers, and tranquil natural springs.
          </p>
        </div>

        {/* Map & Detail Container */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          {/* Left: Interactive Map Visual (7 cols) */}
          <div className="lg:col-span-7 bg-[#faf7f2] rounded-3xl p-6 sm:p-8 border-2 border-stone-200 shadow-inner relative min-h-[420px] flex flex-col justify-between">
            {/* Top Region Label */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-200">
              <span className="text-xs font-bold uppercase tracking-wider text-[#3d5a4c]">
                North Florida Care Corridor (I-75 / I-10 / US-27)
              </span>
              <span className="text-xs font-semibold text-stone-600">Click a campus pin below</span>
            </div>

            {/* Simulated County Vector Region */}
            <div className="grid grid-cols-3 gap-3 my-4">
              {/* Lafayette County Box */}
              <div className="p-4 rounded-2xl bg-white/80 border border-stone-200 flex flex-col justify-between min-h-[140px]">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600">
                    Lafayette County
                  </div>
                  <div className="font-bold text-sm text-[#1e2b24]">Mayo, FL</div>
                </div>

                <div className="space-y-1.5 pt-2">
                  <button
                    onClick={() => setSelectedPin("oakridge")}
                    className={`w-full text-left p-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                      selectedPin === "oakridge"
                        ? "bg-[#A94724] text-white shadow-sm"
                        : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                    }`}
                  >
                    <span>Oakridge</span>
                    <MapPin className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setSelectedPin("homewood")}
                    className={`w-full text-left p-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                      selectedPin === "homewood"
                        ? "bg-[#A94724] text-white shadow-sm"
                        : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                    }`}
                  >
                    <span>Homewood Lodge</span>
                    <MapPin className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Suwannee County Box */}
              <div className="p-4 rounded-2xl bg-white/80 border border-stone-200 flex flex-col justify-between min-h-[140px]">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600">
                    Suwannee County
                  </div>
                  <div className="font-bold text-sm text-[#1e2b24]">Live Oak, FL</div>
                </div>

                <div className="pt-2">
                  <button
                    onClick={() => setSelectedPin("rising-oaks")}
                    className={`w-full text-left p-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                      selectedPin === "rising-oaks"
                        ? "bg-[#A94724] text-white shadow-sm"
                        : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                    }`}
                  >
                    <span>Rising Oaks</span>
                    <MapPin className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Columbia County Box */}
              <div className="p-4 rounded-2xl bg-white/80 border border-stone-200 flex flex-col justify-between min-h-[140px]">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600">
                    Columbia County
                  </div>
                  <div className="font-bold text-sm text-[#1e2b24]">Lake City, FL</div>
                </div>

                <div className="space-y-1.5 pt-2">
                  <button
                    onClick={() => setSelectedPin("plantation")}
                    className={`w-full text-left p-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                      selectedPin === "plantation"
                        ? "bg-[#A94724] text-white shadow-sm"
                        : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                    }`}
                  >
                    <span>Plantation on Summers</span>
                    <MapPin className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => setSelectedPin("grande-cypress")}
                    className={`w-full text-left p-2 rounded-xl text-xs font-bold transition-all flex items-center justify-between ${
                      selectedPin === "grande-cypress"
                        ? "bg-[#A94724] text-white shadow-sm"
                        : "bg-stone-100 text-stone-700 hover:bg-stone-200"
                    }`}
                  >
                    <span>Grande Cypress</span>
                    <MapPin className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            {/* Travel Times Grid */}
            <div className="pt-3 border-t border-stone-200">
              <div className="text-[11px] font-bold uppercase tracking-wider text-stone-600 mb-2 flex items-center gap-1.5">
                <Car className="w-3.5 h-3.5 text-[#3d5a4c]" />
                <span>Estimated Family Travel Times:</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] text-stone-600">
                {driveTimes.slice(3).map((dt, i) => (
                  <div key={i} className="p-2 rounded-lg bg-white border border-stone-200">
                    <span className="font-bold text-[#1e2b24] block">{dt.from}:</span>
                    <span className="text-[#3d5a4c] font-medium">{dt.time}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Right: Selected Campus Proximity Profile (5 cols) */}
          <div className="lg:col-span-5 bg-[#faf7f2] p-7 rounded-3xl border border-stone-200 shadow-sm space-y-5">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-[#3d5a4c]">
                {activeFacility.address.county} Flagship
              </span>
              <h3 className="text-2xl font-bold text-[#1e2b24] font-serif mt-0.5">
                {activeFacility.name}
              </h3>
              <p className="text-xs text-stone-600 mt-1">{activeFacility.address.street}, {activeFacility.address.city}, FL {activeFacility.address.zip}</p>
            </div>

            {/* Nearby Healthcare Anchor Badges */}
            <div className="space-y-2.5">
              <div className="text-xs font-bold uppercase tracking-wider text-stone-600">
                Nearby Medical Facilities & Emergency Access:
              </div>
              <div className="space-y-2">
                {activeFacility.nearbyHealthcare.map((hc, idx) => (
                  <div
                    key={idx}
                    className="p-3 rounded-xl bg-white border border-stone-200 flex items-center justify-between text-xs"
                  >
                    <div>
                      <div className="font-bold text-[#1e2b24]">{hc.facility}</div>
                      <div className="text-stone-600 text-[11px]">{hc.type}</div>
                    </div>
                    <span className="font-bold text-[#3d5a4c] bg-stone-100 px-2 py-1 rounded-md">
                      {hc.distance}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="pt-2 flex items-center justify-between border-t border-stone-200">
              <div>
                <span className="text-[11px] text-stone-600 block">Direct Admissions</span>
                <a
                  href={`tel:${activeFacility.phone}`}
                  className="font-bold text-sm text-[#A94724] flex items-center gap-1"
                >
                  <Phone className="w-3.5 h-3.5" />
                  <span>{activeFacility.phone}</span>
                </a>
              </div>

              <Link
                href={`/campuses/${activeFacility.slug}`}
                className="py-2.5 px-4 rounded-xl bg-[#1e2b24] hover:bg-stone-800 text-white font-bold text-xs transition-colors flex items-center gap-1.5"
              >
                <span>View Campus</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
