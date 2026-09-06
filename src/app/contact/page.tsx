"use client";

import React, { useState } from "react";
import { WebHeader } from "@/components/web/web-header";
import { WebFooter } from "@/components/web/web-footer";
import { StickyCareConcierge } from "@/components/web/sticky-care-concierge";
import { Phone, CheckCircle2, Clock } from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";
import Image from "next/image";

export default function ContactPage() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [locationPreference, setLocationPreference] = useState(FACILITIES[0].id);
  const [message, setMessage] = useState("");
  const [submitted, setSubmitted] = useState(false);

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
            src="https://images.unsplash.com/photo-1516726817505-f5ed825624d8?auto=format&fit=crop&w=1600&q=80"
            alt="Compassionate Contact"
            className="absolute inset-0 w-full h-full object-cover opacity-25" unoptimized loading="eager" fill sizes="100vw"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-stone-950 via-stone-950/75 to-stone-900/40" />

          <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 text-center space-y-6">
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-white/10 backdrop-blur-md text-amber-300 text-xs font-bold uppercase tracking-widest border border-amber-300/30">
              <Phone className="w-3.5 h-3.5 text-[#C85A32]" />
              <span>We Are Here For You Day or Night</span>
            </div>
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold font-serif max-w-3xl mx-auto leading-tight">
              Contact Our Care Directors
            </h1>
            <p className="text-stone-300 text-base sm:text-lg max-w-2xl mx-auto leading-relaxed font-normal">
              Whether you need rapid 24-hour hospital placement triage or simply want to ask a few
              gentle questions about caring for mom, we are always here to listen.
            </p>
          </div>
        </section>

        {/* 2-Column Contact Container */}
        <section className="py-20 px-4 sm:px-6 lg:px-8">
          <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-12 gap-12">
            {/* Left: 24/7 Admissions & Campus Directory (5 cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* Rapid Admissions Card */}
              <div className="p-8 rounded-3xl bg-[#1C2822] text-white space-y-5 border border-stone-800 shadow-2xl">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 text-xs font-bold uppercase tracking-widest border border-emerald-400/30">
                  <Clock className="w-3.5 h-3.5" />
                  <span>24/7 Rapid Crisis Admissions</span>
                </div>

                <h2 className="text-2xl sm:text-3xl font-bold font-serif">Need Placement Today?</h2>
                <p className="text-xs sm:text-sm text-stone-300 leading-relaxed">
                  Hospital discharge planners, case managers, and family members facing sudden emergencies can reach our on-call admissions team 24 hours a day.
                </p>

                <a
                  href="tel:3864060887"
                  className="inline-flex items-center justify-center gap-2 w-full py-4 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-sm shadow-lg shadow-[#C85A32]/30 hover:scale-[1.02] transition-transform"
                >
                  <Phone className="w-4 h-4 text-amber-200" />
                  <span>Call (386) 406-0887 Now</span>
                </a>
              </div>

              {/* Campus Direct Lines */}
              <div className="p-7 rounded-3xl bg-white border-2 border-stone-200 shadow-sm space-y-4">
                <h3 className="text-xs font-bold uppercase tracking-widest text-[#3D5A4C]">
                  Campus Direct Numbers:
                </h3>
                <div className="space-y-3">
                  {FACILITIES.map((f) => (
                    <div key={f.id} className="flex items-center justify-between text-xs pb-3 border-b border-stone-100 last:border-0 last:pb-0">
                      <div>
                        <div className="font-bold text-sm text-[#1C2822]">{f.name}</div>
                        <div className="text-stone-500 text-[11px]">{f.address.city}, FL • {f.administrator.name}</div>
                      </div>
                      <a href={`tel:${f.phone}`} className="font-bold text-[#C85A32] hover:underline text-xs">
                        {f.phone}
                      </a>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Message Form (7 cols) */}
            <div className="lg:col-span-7 bg-white rounded-3xl p-8 sm:p-12 border-2 border-stone-200 shadow-xl">
              {!submitted ? (
                <form onSubmit={handleSubmit} className="space-y-6">
                  <div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-[#1C2822] font-serif">Send Us a Gentle Note</h2>
                    <p className="text-xs sm:text-sm text-stone-500 mt-1">
                      A local administrator will review your message and reach out with compassion within 2 hours.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-stone-700 block mb-1.5">Your Full Name</label>
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
                      <label className="text-xs font-bold text-stone-700 block mb-1.5">Phone Number</label>
                      <input
                        type="tel"
                        required
                        placeholder="(386) 555-0199"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="text-xs font-bold text-stone-700 block mb-1.5">Email Address</label>
                      <input
                        type="email"
                        required
                        placeholder="sarah@example.com"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                      />
                    </div>

                    <div>
                      <label className="text-xs font-bold text-stone-700 block mb-1.5">Preferred Community</label>
                      <select
                        value={locationPreference}
                        onChange={(e) => setLocationPreference(e.target.value)}
                        className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                      >
                        {FACILITIES.map((f) => (
                          <option key={f.id} value={f.id}>
                            {f.name} ({f.address.city})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs font-bold text-stone-700 block mb-1.5">How can we help your family?</label>
                    <textarea
                      rows={4}
                      required
                      placeholder="Tell us about mom or dad's current situation, any medication needs, or preferred timeline..."
                      value={message}
                      onChange={(e) => setMessage(e.target.value)}
                      className="w-full px-4 py-3 rounded-xl border border-stone-300 text-xs bg-[#FAF7F2] focus:outline-none focus:ring-2 focus:ring-[#C85A32]"
                    />
                  </div>

                  <button
                    type="submit"
                    className="w-full py-4.5 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-sm shadow-xl shadow-[#C85A32]/30 hover:scale-[1.01] transition-all"
                  >
                    Send Confidential Inquiry
                  </button>
                </form>
              ) : (
                <div className="py-16 text-center space-y-4 animate-in fade-in duration-200">
                  <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-600 mx-auto flex items-center justify-center shadow-inner">
                    <CheckCircle2 className="w-9 h-9" />
                  </div>
                  <h3 className="text-2xl sm:text-3xl font-bold text-[#1C2822] font-serif">Message Received, {name}!</h3>
                  <p className="text-sm text-stone-600 max-w-md mx-auto leading-relaxed">
                    Thank you for reaching out. An Executive Director from our team will call you shortly to assist your family.
                  </p>
                </div>
              )}
            </div>
          </div>
        </section>
      </main>

      <WebFooter />
      <StickyCareConcierge />
    </div>
  );
}
