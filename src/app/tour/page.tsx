"use client";

import React, { useState } from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import {
  Calendar,
  Utensils,
  CheckCircle2
} from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";
import Image from "next/image";

export default function TourPage() {
  const [selectedFacility, setSelectedFacility] = useState<string>(FACILITIES[0].id);
  const [tourDate, setTourDate] = useState<string>("");
  const [tourTime, setTourTime] = useState<string>("11:30 AM (Lunch Included)");
  const [lunchOption, setLunchOption] = useState<string>("yes-2");
  const [name, setName] = useState<string>("");
  const [phone, setPhone] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [submitted, setSubmitted] = useState<boolean>(false);

  const targetFacility = FACILITIES.find((f) => f.id === selectedFacility) || FACILITIES[0];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
  };

  return (
    <div className="min-h-screen flex flex-col bg-[#FAF7F2] text-[#1C2822] font-sans">
      <WebHeader />

      <main className="flex-1">
        {/* Luxury Hero Banner */}
        <section className="relative overflow-hidden bg-stone-950 text-white py-20 sm:py-28">
          <Image
            src="https://images.unsplash.com/photo-1544027993-37dbfe43562a?auto=format&fit=crop&w=1600&q=80"
            alt="Southern Hospitality Tour"
            className="absolute inset-0 w-full h-full object-cover opacity-25" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-300/30">
              <Calendar className="w-3.5 h-3.5 text-[#C85A32]" />
              <span>Complimentary VIP Family Visit</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl mx-auto leading-tight">
              Experience a Day in the Life With Mom
            </h1>
            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal">
              Join us for a private walkthrough, meet our on-site Executive Director, explore our
              sunlit suites, and enjoy a complimentary Southern home-cooked lunch on us.
            </p>
          </div>
        </section>

        {/* Tour Booking Form */}
        <section className="py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-3xl mx-auto bg-white rounded-3xl p-8 sm:p-12 border-2 border-stone-200 shadow-xl">
            {!submitted ? (
              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-[#1C2822] font-serif">
                    Select Your Preferred Campus & Time
                  </h2>
                  <p className="text-xs sm:text-sm text-stone-500 mt-1">
                    No high-pressure sales. Just genuine Southern hospitality, answers to your questions, and transparent numbers.
                  </p>
                </div>

                {/* Campus Choice */}
                <div>
                  <label className="text-xs font-bold uppercase tracking-widest text-stone-700 block mb-2">
                    1. Choose Community
                  </label>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {FACILITIES.map((f) => (
                      <button
                        type="button"
                        key={f.id}
                        onClick={() => setSelectedFacility(f.id)}
                        className={`p-4 rounded-2xl text-left border-2 transition-all ${
                          selectedFacility === f.id
                            ? "bg-[#1C2822] text-white border-[#1C2822] shadow-md"
                            : "bg-[#FAF7F2] border-stone-200 text-stone-800 hover:bg-stone-100"
                        }`}
                      >
                        <div className="font-bold text-sm">{f.name}</div>
                        <div
                          className={`text-xs mt-1 ${
                            selectedFacility === f.id ? "text-[#E5A952] font-semibold" : "text-stone-500"
                          }`}
                        >
                          {f.address.city}, FL • {f.availableBeds} Suites Available
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Date & Time */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-stone-700 block mb-1.5">
                      2. Date of Visit
                    </label>
                    <input
                      type="date"
                      required
                      value={tourDate}
                      onChange={(e) => setTourDate(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold uppercase tracking-widest text-stone-700 block mb-1.5">
                      3. Preferred Time
                    </label>
                    <select
                      value={tourTime}
                      onChange={(e) => setTourTime(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                    >
                      <option>10:00 AM (Morning Coffee & Porch)</option>
                      <option>11:30 AM (Lunch with Residents Included)</option>
                      <option>02:00 PM (Afternoon Activities & Tea)</option>
                      <option>04:30 PM (Evening Tour)</option>
                      <option>Saturday 11:00 AM (Weekend Family Tour)</option>
                    </select>
                  </div>
                </div>

                {/* Lunch Option */}
                <div className="p-5 rounded-2xl bg-[#FAF7F2] border border-stone-200 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-[#1C2822]">
                    <Utensils className="w-4 h-4 text-[#C85A32]" />
                    <span>Complimentary Chef-Prepared Lunch:</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <button
                      type="button"
                      onClick={() => setLunchOption("yes-2")}
                      className={`py-3 px-2 rounded-xl font-bold text-center border transition-all ${
                        lunchOption === "yes-2"
                          ? "bg-[#C85A32] text-white border-[#C85A32] shadow-sm"
                          : "bg-white border-stone-300 text-stone-700"
                      }`}
                    >
                      Yes, Lunch for 2
                    </button>
                    <button
                      type="button"
                      onClick={() => setLunchOption("coffee")}
                      className={`py-3 px-2 rounded-xl font-bold text-center border transition-all ${
                        lunchOption === "coffee"
                          ? "bg-[#C85A32] text-white border-[#C85A32] shadow-sm"
                          : "bg-white border-stone-300 text-stone-700"
                      }`}
                    >
                      Coffee & Dessert
                    </button>
                    <button
                      type="button"
                      onClick={() => setLunchOption("tour-only")}
                      className={`py-3 px-2 rounded-xl font-bold text-center border transition-all ${
                        lunchOption === "tour-only"
                          ? "bg-[#C85A32] text-white border-[#C85A32] shadow-sm"
                          : "bg-white border-stone-300 text-stone-700"
                      }`}
                    >
                      Quick Tour Only
                    </button>
                  </div>
                </div>

                {/* Contact Info */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="text-xs font-bold text-stone-700 block mb-1">Your Full Name</label>
                    <input
                      type="text"
                      required
                      placeholder="Sarah Thornton"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-stone-700 block mb-1">Mobile Phone (for SMS)</label>
                    <input
                      type="tel"
                      required
                      placeholder="(386) 555-0199"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-bold text-stone-700 block mb-1">Email Address</label>
                    <input
                      type="email"
                      required
                      placeholder="sarah@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                    />
                  </div>
                </div>

                <button
                  type="submit"
                  className="w-full py-4.5 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-sm shadow-xl shadow-[#C85A32]/30 hover:scale-[1.01] transition-all"
                >
                  <Calendar className="w-4 h-4 text-amber-200 inline mr-2" />
                  <span>Reserve VIP Visit & Complimentary Lunch</span>
                </button>
              </form>
            ) : (
              <div className="text-center space-y-6 py-10 animate-in fade-in duration-300">
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-inner">
                  <CheckCircle2 className="w-10 h-10" />
                </div>

                <div>
                  <div className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                    Tour Confirmed
                  </div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-[#1C2822] font-serif mt-1">
                    We Are Excited to Welcome You, {name}!
                  </h2>
                  <p className="text-sm text-stone-600 mt-2 max-w-md mx-auto leading-relaxed">
                    Your visit to <strong>{targetFacility.name}</strong> is confirmed for{" "}
                    <strong>{tourDate || "this week"}</strong> at <strong>{tourTime}</strong>.
                  </p>
                </div>

                <div className="p-6 rounded-2xl bg-[#FAF7F2] border border-stone-200 text-left max-w-md mx-auto text-xs space-y-2.5 shadow-xs">
                  <div className="flex justify-between text-stone-600">
                    <span>Facility Location:</span>
                    <span className="font-bold text-[#1C2822]">{targetFacility.address.street}, {targetFacility.address.city}</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>Executive Director:</span>
                    <span className="font-bold text-[#1C2822]">{targetFacility.administrator.name}</span>
                  </div>
                  <div className="flex justify-between text-stone-600">
                    <span>Direct Phone:</span>
                    <span className="font-bold text-[#C85A32]">{targetFacility.phone}</span>
                  </div>
                </div>

                <p className="text-xs text-stone-500">
                  Driving directions and your confirmation details have been sent via SMS.
                </p>
              </div>
            )}
          </div>
        </section>
      </main>

      <WebFooter />
      <StickyCareConcierge />
    </div>
  );
}
