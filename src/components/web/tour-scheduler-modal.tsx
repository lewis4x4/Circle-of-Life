"use client";

import React, { useState } from "react";
import {
  X,
  Calendar,
  Utensils,
  CheckCircle2,
  Sparkles
} from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";
import { PUBLIC_TOUR_TIMES, type PublicReferral } from "@/lib/referrals/public-referral";
import { usePublicReferral } from "@/lib/referrals/use-public-referral";

interface TourSchedulerModalProps {
  isOpen: boolean;
  onClose: () => void;
  defaultFacilityId?: string;
}

export function TourSchedulerModal({
  isOpen,
  onClose,
  defaultFacilityId,
}: TourSchedulerModalProps) {
  const [selectedFacility, setSelectedFacility] = useState<string>(
    defaultFacilityId || FACILITIES[0].id
  );
  const [tourDate, setTourDate] = useState<string>("");
  const [tourTime, setTourTime] = useState<string>(PUBLIC_TOUR_TIMES[1]);
  const [lunchOption, setLunchOption] = useState<string>("yes-2");
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [submitted, setSubmitted] = useState<boolean>(false);
  const { submit, pending, error } = usePublicReferral();

  if (!isOpen) return null;

  const targetFacility =
    FACILITIES.find((f) => f.id === selectedFacility) || FACILITIES[0];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await submit({ kind: "tour", facility: selectedFacility as PublicReferral["facility"], name, phone, email,
      tourDate, tourTime: tourTime as typeof PUBLIC_TOUR_TIMES[number], lunchOption: lunchOption as "yes-2" | "coffee" | "tour-only" })) {
      setSubmitted(true);
    }
  };

  const handleReset = () => {
    setSubmitted(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-stone-950/70 backdrop-blur-sm overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white rounded-3xl shadow-2xl border border-stone-200 overflow-hidden my-8 animate-in fade-in zoom-in-95 duration-200">
        {/* Close Button */}
        <button
          onClick={onClose}
          aria-label="Close tour request"
          disabled={pending}
          className="absolute top-5 right-5 p-2 rounded-full bg-stone-100 hover:bg-stone-200 text-stone-600 transition-colors z-10"
        >
          <X className="w-5 h-5" />
        </button>

        {!submitted ? (
          <form onSubmit={handleSubmit} className="p-6 sm:p-8">
            <fieldset disabled={pending} className="space-y-6">
            {/* Header */}
            <div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#c86d51]/10 text-[#c86d51] text-xs font-bold uppercase tracking-wider mb-2">
                <Sparkles className="w-3.5 h-3.5" />
                <span>The VIP Family Tour Experience</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#1e2b24] font-serif">
                Request a Private Visit & Chef&apos;s Lunch
                                            </h2>
              <p className="text-xs sm:text-sm text-stone-600 mt-1">
                Experience a day in the life. Meet our on-site Administrator, explore available private
                suites, and enjoy a complimentary home-cooked Southern meal on us.
              </p>
            </div>

            {/* Step 1: Select Facility */}
            <div>
              <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-2">
                1. Select North Florida Campus
              </label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {FACILITIES.map((f) => (
                  <button
                    type="button"
                    key={f.id}
                    onClick={() => setSelectedFacility(f.id)}
                    className={`p-3 rounded-xl text-left border transition-all text-xs ${
                      selectedFacility === f.id
                        ? "bg-[#1e2b24] text-white border-[#1e2b24] shadow-sm"
                        : "bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100"
                    }`}
                  >
                    <div className="font-bold">{f.name}</div>
                    <div
                      className={`text-[11px] mt-0.5 ${
                        selectedFacility === f.id ? "text-amber-300" : "text-stone-600"
                      }`}
                    >
                      {f.address.city}, FL • {f.availableBeds} Suites Open
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Step 2: Date & Time */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-1.5">
                  2. Preferred Date
                </label>
                <input
                  type="date"
                  aria-label="Preferred Date"
                  required
                  value={tourDate}
                  onChange={(e) => setTourDate(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#3d5a4c]"
                />
              </div>

              <div>
                <label className="text-xs font-bold uppercase tracking-wider text-stone-600 block mb-1.5">
                  3. Preferred Time
                </label>
                <select
                  aria-label="Preferred Time"
                  value={tourTime}
                  onChange={(e) => setTourTime(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-stone-300 text-xs bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#3d5a4c]"
                >
                  {PUBLIC_TOUR_TIMES.map((time) => <option key={time}>{time}</option>)}
                </select>
              </div>
            </div>

            {/* Step 3: Complimentary Lunch Option */}
            <div className="p-4 rounded-2xl bg-[#faf7f2] border border-stone-200 space-y-2">
              <div className="flex items-center gap-2 text-xs font-bold text-[#1e2b24]">
                <Utensils className="w-4 h-4 text-[#c86d51]" />
                <span>Complimentary Chef-Prepared Lunch for Your Family:</span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <button
                  type="button"
                  onClick={() => setLunchOption("yes-2")}
                  className={`py-2 px-2 rounded-xl font-semibold text-center border transition-all ${
                    lunchOption === "yes-2"
                      ? "bg-[#c86d51] text-white border-[#c86d51]"
                      : "bg-white border-stone-300 text-stone-700"
                  }`}
                >
                  Yes, Lunch for 2
                </button>
                <button
                  type="button"
                  onClick={() => setLunchOption("coffee")}
                  className={`py-2 px-2 rounded-xl font-semibold text-center border transition-all ${
                    lunchOption === "coffee"
                      ? "bg-[#c86d51] text-white border-[#c86d51]"
                      : "bg-white border-stone-300 text-stone-700"
                  }`}
                >
                  Coffee & Dessert
                </button>
                <button
                  type="button"
                  onClick={() => setLunchOption("tour-only")}
                  className={`py-2 px-2 rounded-xl font-semibold text-center border transition-all ${
                    lunchOption === "tour-only"
                      ? "bg-[#c86d51] text-white border-[#c86d51]"
                      : "bg-white border-stone-300 text-stone-700"
                  }`}
                >
                  Quick Tour Only
                </button>
              </div>
            </div>

            {/* Step 4: Contact Information */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1">Your Full Name</label>
                <input
                  type="text"
                  aria-label="Your Full Name"
                  maxLength={160}
                  required
                  placeholder="Sarah Thornton"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#3d5a4c]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1">Mobile Phone (for SMS)</label>
                <input
                  type="tel"
                  aria-label="Mobile Phone"
                  maxLength={40}
                  required
                  placeholder="(386) 555-0199"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#3d5a4c]"
                />
              </div>

              <div>
                <label className="text-xs font-bold text-stone-600 block mb-1">Email Address</label>
                <input
                  type="email"
                  aria-label="Email Address"
                  maxLength={254}
                  required
                  placeholder="sarah@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-stone-300 text-xs bg-stone-50 focus:outline-none focus:ring-2 focus:ring-[#3d5a4c]"
                />
              </div>
            </div>

            {/* Submit CTA */}
            {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
            <button
              type="submit"
              disabled={pending}
              className="w-full py-4 rounded-2xl bg-[#c86d51] hover:bg-[#b55e43] text-white font-bold text-sm shadow-xl shadow-[#c86d51]/30 transition-all flex items-center justify-center gap-2"
            >
              <Calendar className="w-4 h-4 text-amber-200" />
              <span>{pending ? "Sending Tour Request…" : "Request Tour & Complimentary Lunch"}</span>
            </button>
            </fieldset>
          </form>
        ) : (
          /* Confirmation Success Screen */
          <div className="p-8 sm:p-10 text-center space-y-6 animate-in fade-in duration-300">
            <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-inner">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-[#3d5a4c]">
                Tour Request Received
              </div>
              <h2 className="text-2xl sm:text-3xl font-bold text-[#1e2b24] font-serif mt-1">
                Thank You, {name || "Friend"}!
              </h2>
              <p className="text-sm text-stone-600 mt-2 max-w-lg mx-auto leading-relaxed">
                You requested a visit to <strong className="text-[#1e2b24]">{targetFacility.name}</strong> for
                <strong className="text-[#1e2b24]"> {tourDate}</strong> at{" "}
                <strong className="text-[#1e2b24]">{tourTime}</strong>.
              </p>
            </div>

            {/* Confirmation Box */}
            <div className="p-5 rounded-2xl bg-[#faf7f2] border border-stone-200 text-left max-w-md mx-auto text-xs space-y-2">
              <div className="flex justify-between text-stone-600">
                <span>Campus Location:</span>
                <span className="font-bold text-[#1e2b24]">{targetFacility.address.street}, {targetFacility.address.city}</span>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>Executive Director:</span>
                <span className="font-bold text-[#1e2b24]">{targetFacility.administrator.name}</span>
              </div>
              <div className="flex justify-between text-stone-600">
                <span>Direct Line:</span>
                <span className="font-bold text-[#c86d51]">{targetFacility.phone}</span>
              </div>
            </div>

            <p className="text-xs text-stone-600">
              Our team will contact you to confirm availability, the visit time and any lunch arrangements. No tour is booked yet.
                                          </p>

            <button
              onClick={handleReset}
              className="px-8 py-3 rounded-xl bg-[#1e2b24] hover:bg-stone-800 text-white font-bold text-xs transition-colors"
            >
              Done
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
