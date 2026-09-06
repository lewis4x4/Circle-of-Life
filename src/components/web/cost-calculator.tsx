"use client";

import React, { useState } from "react";
import {
  DollarSign,
  CheckCircle2,
  Calendar
} from "lucide-react";
import {
  BASE_ROOM_TIERS,
  CARE_LEVELS,
  FINANCIAL_OFFSETS,
  PricingTier,
  CareLevel,
} from "@/lib/data/pricing-data";

interface CostCalculatorProps {
  onOpenTourModal?: () => void;
}

export function CostCalculator({ onOpenTourModal }: CostCalculatorProps) {
  const [suiteType, setSuiteType] = useState<string>("semi-private");
  const [careLevelId, setCareLevelId] = useState<string>("level-1");
  const [selectedOffsets, setSelectedOffsets] = useState<string[]>([]);

  const selectedBase =
    BASE_ROOM_TIERS.find((r: PricingTier) => r.id === suiteType) || BASE_ROOM_TIERS[0];
  const selectedCare =
    CARE_LEVELS.find((c: CareLevel) => c.id === careLevelId) || CARE_LEVELS[1];

  const totalOffsetsAmount = selectedOffsets.reduce((acc, offsetId) => {
    const found = FINANCIAL_OFFSETS.find((o) => o.id === offsetId);
    return acc + (found ? found.monthlySavings : 0);
  }, 0);

  const estimatedMonthlyGross = selectedBase.monthlyBaseRate + selectedCare.monthlyFee;
  const estimatedMonthlyNet = Math.max(0, estimatedMonthlyGross - totalOffsetsAmount);

  const toggleOffset = (offsetId: string) => {
    if (selectedOffsets.includes(offsetId)) {
      setSelectedOffsets(selectedOffsets.filter((id) => id !== offsetId));
    } else {
      setSelectedOffsets([...selectedOffsets, offsetId]);
    }
  };

  return (
    <section className="py-24 bg-[#FAF7F2] border-b border-stone-200/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Section Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-2 px-3.5 py-1 rounded-full bg-[#3D5A4C]/10 text-[#3D5A4C] text-xs font-bold uppercase tracking-widest mb-2">
            <DollarSign className="w-3.5 h-3.5 text-[#A94724]" />
            <span>100% Financial Transparency</span>
          </div>
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold text-[#1C2822] font-serif">
            Interactive Care & Monthly Investment Studio
          </h2>
          <p className="text-stone-600 text-sm sm:text-base mt-2">
            Calculate your true monthly investment with zero hidden fees. Compare directly against the
            rising costs of fragmented in-home care.
          </p>
        </div>

        {/* 2-Column Calculator Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Left Column: Interactive Inputs (7 cols) */}
          <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-10 border-2 border-stone-200 shadow-md space-y-8">
            {/* Step 1: Suite Style */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-widest text-stone-600">
                  1. Select Suite Accommodation
                </span>
                <span className="text-xs text-stone-600">All utilities & meals included</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {BASE_ROOM_TIERS.map((rate: PricingTier) => (
                  <button
                    key={rate.id}
                    onClick={() => setSuiteType(rate.id)}
                    className={`p-4 rounded-2xl border-2 text-left transition-all ${
                      suiteType === rate.id
                        ? "bg-[#1C2822] text-white border-[#1C2822] shadow-md scale-[1.01]"
                        : "bg-[#FAF7F2] border-stone-200 text-stone-800 hover:border-stone-400"
                    }`}
                  >
                    <div className="font-bold text-sm">{rate.name}</div>
                    <div className={`text-lg font-serif font-bold mt-1 ${suiteType === rate.id ? "text-[#E5A952]" : "text-[#785015]"}`}>
                      ${rate.monthlyBaseRate.toLocaleString()}
                      <span className="text-xs font-sans font-normal"> / mo</span>
                    </div>
                    <div className={`text-[11px] mt-1 ${suiteType === rate.id ? "text-stone-300" : "text-stone-600"}`}>
                      {rate.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: ADL Care Level */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-widest text-stone-600">
                  2. Level of Daily Hands-On Care (ADLs)
                </span>
                <span className="text-xs text-[#3D5A4C] font-semibold">24/7 Nursing Supervision</span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {CARE_LEVELS.map((level) => (
                  <button
                    key={level.id}
                    onClick={() => setCareLevelId(level.id)}
                    className={`p-3.5 rounded-2xl border-2 text-left transition-all text-xs ${
                      careLevelId === level.id
                        ? "bg-[#1C2822] text-white border-[#1C2822] shadow-sm"
                        : "bg-[#FAF7F2] border-stone-200 text-stone-800 hover:border-stone-400"
                    }`}
                  >
                    <div className="flex items-center justify-between font-bold">
                      <span>{level.tier}: {level.name}</span>
                      <span className={careLevelId === level.id ? "text-[#E5A952]" : "text-[#785015]"}>
                        {level.monthlyFee === 0 ? "+$0" : `+$${level.monthlyFee}/mo`}
                      </span>
                    </div>
                    <div className={`text-[11px] mt-1 line-clamp-2 ${careLevelId === level.id ? "text-stone-300" : "text-stone-600"}`}>
                      {level.description}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 3: Veterans & Financial Offsets */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-bold uppercase tracking-widest text-stone-600">
                  3. Veterans & Benefit Offsets (Optional)
                </span>
                <span className="text-xs text-amber-700 font-semibold">VA Tax-Free Pensions</span>
              </div>

              <div className="grid grid-cols-1 gap-2">
                {FINANCIAL_OFFSETS.map((offset) => {
                  const isChecked = selectedOffsets.includes(offset.id);
                  return (
                    <button
                      key={offset.id}
                      onClick={() => toggleOffset(offset.id)}
                      className={`p-3.5 rounded-2xl border-2 text-left transition-all flex items-center justify-between text-xs ${
                        isChecked
                          ? "bg-emerald-900/10 border-emerald-600 text-emerald-950 shadow-xs"
                          : "bg-[#FAF7F2] border-stone-200 text-stone-700 hover:border-stone-400"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`w-5 h-5 rounded-lg border flex items-center justify-center ${
                            isChecked ? "bg-emerald-600 border-emerald-600 text-white" : "border-stone-400 bg-white"
                          }`}
                        >
                          {isChecked && <CheckCircle2 className="w-3.5 h-3.5" />}
                        </div>
                        <div>
                          <div className="font-bold text-[#1C2822]">{offset.name}</div>
                          <div className="text-[11px] text-stone-600">{offset.description}</div>
                        </div>
                      </div>
                      <span className="font-bold text-emerald-800 text-sm whitespace-nowrap ml-2">
                        -${offset.monthlySavings.toLocaleString()} / mo
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column: Instant Financial Summary & Comparison (5 cols) */}
          <div className="lg:col-span-5 space-y-6">
            {/* The Summary Card */}
            <div className="bg-[#1C2822] text-white rounded-3xl p-8 border border-stone-800 shadow-2xl space-y-6">
              <div>
                <span className="text-[10px] font-bold uppercase tracking-widest text-[#E5A952]">
                  Estimated All-Inclusive Investment
                </span>
                <div className="text-4xl sm:text-5xl font-bold font-serif text-white mt-1">
                  ${estimatedMonthlyNet.toLocaleString()}
                  <span className="text-sm font-sans font-normal text-stone-300"> / month</span>
                </div>
                {totalOffsetsAmount > 0 && (
                  <div className="text-xs text-emerald-400 font-semibold mt-1">
                    Includes ${totalOffsetsAmount.toLocaleString()}/mo in applied benefit offsets
                  </div>
                )}
              </div>

              {/* Line Item Breakdown */}
              <div className="pt-4 border-t border-stone-800 space-y-2 text-xs text-stone-300">
                <div className="flex justify-between">
                  <span>Base Suite ({selectedBase.name}):</span>
                  <span className="font-bold text-white">${selectedBase.monthlyBaseRate.toLocaleString()}/mo</span>
                </div>
                <div className="flex justify-between">
                  <span>Care Level ({selectedCare.tier}):</span>
                  <span className="font-bold text-white">${selectedCare.monthlyFee.toLocaleString()}/mo</span>
                </div>
                {totalOffsetsAmount > 0 && (
                  <div className="flex justify-between text-emerald-400 font-semibold">
                    <span>Applied Benefit Offsets:</span>
                    <span>-${totalOffsetsAmount.toLocaleString()}/mo</span>
                  </div>
                )}
              </div>

              {/* Included Amenities Checklist */}
              <div className="pt-4 border-t border-stone-800 space-y-1.5 text-[11px] text-stone-300">
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>3 Chef-Prepared Meals Daily + Snacks & Hydration</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>24/7 Certified Medication Administration (eMAR)</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Housekeeping, Fresh Linens & Personal Laundry</span>
                </div>
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                  <span>Zero Entrance Fees • Zero Long-Term Leases</span>
                </div>
              </div>

              <button
                onClick={onOpenTourModal}
                className="w-full py-4 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] hover:scale-[1.02] text-white font-bold text-sm shadow-xl shadow-[#C85A32]/30 transition-all flex items-center justify-center gap-2"
              >
                <Calendar className="w-4 h-4 text-amber-200" />
                <span>Schedule a VIP Visit & Lock in Rate</span>
              </button>
            </div>

            {/* In-Home Care Cost Comparison Callout */}
            <div className="p-6 rounded-3xl bg-white border-2 border-stone-200 shadow-sm space-y-3">
              <div className="text-xs font-bold uppercase tracking-wider text-[#A94724]">
                Did You Know? True Cost of In-Home Care:
              </div>
              <p className="text-xs text-stone-600 leading-relaxed">
                24/7 private home caregivers average <strong>$8,080/month</strong> in North Florida—plus groceries, home maintenance, utilities, and emergency generators.
              </p>
              <div className="text-xs font-bold text-emerald-800 bg-emerald-50 p-2.5 rounded-xl border border-emerald-200">
                Circle of Life saves families up to $4,000/month while providing 24/7 loving companionship.
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
