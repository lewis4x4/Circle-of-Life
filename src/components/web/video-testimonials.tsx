"use client";

import React from "react";
import { Star, Quote } from "lucide-react";
import Image from "next/image";

export function VideoTestimonials() {
  const testimonials = [
    {
      author: "Sarah Thornton",
      relationship: "Daughter of resident Martha (Plantation on Summers, Lake City)",
      quote:
        "For two agonizing years, I was my mom's nurse, chauffeur, maid, and pharmacist. I was irritable, exhausted, and losing sleep every night terrified she would fall. The day she moved to The Plantation on Summers, I got my mom back. Now when I visit, we laugh, look at photo albums, and eat peach cobbler on the porch.",
      rating: 5,
      town: "Lake City, FL",
      image: "https://images.unsplash.com/photo-1544005313-94ddf0286df2?auto=format&fit=crop&w=300&q=80",
    },
    {
      author: "David McAlister",
      relationship: "Son of resident Frank (Rising Oaks, Live Oak)",
      quote:
        "Dad farmed in Suwannee County his entire life. When his memory began to slip, we were terrified of putting him in a cold corporate facility. Rising Oaks feels like old Florida—canopy oaks, rocking chairs, Sunday pot roast, and staff who know his name and his stories. It saved our family.",
      rating: 5,
      town: "Live Oak, FL",
      image: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=300&q=80",
    },
    {
      author: "Brenda & James Lawson",
      relationship: "Family of resident Clara (Oakridge, Mayo)",
      quote:
        "Administrator Sulma Estrada and the caregivers at Oakridge treat Aunt Clara with reverence. Knowing they have zero state citations and 24/7 medication accuracy allows us to sleep soundly every single night. Circle of Life is an absolute blessing.",
      rating: 5,
      town: "Mayo, FL",
      image: "https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&w=300&q=80",
    },
  ];

  return (
    <section className="py-20 bg-[#faf7f2] border-b border-stone-200/90">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-14">
          <div className="inline-flex items-center gap-1 px-3.5 py-1 rounded-full bg-amber-500/10 text-amber-900 text-xs font-bold uppercase tracking-wider mb-2">
            <div className="flex gap-0.5 text-amber-500">
              {[...Array(5)].map((_, i) => (
                <Star key={i} className="w-3.5 h-3.5 fill-amber-400" />
              ))}
            </div>
            <span className="ml-1">4.9 / 5.0 Rated by North Florida Families</span>
          </div>

          <h2 className="text-3xl sm:text-4xl font-bold text-[#1e2b24] font-serif">
            Heartfelt Stories from Children Who Found Peace
          </h2>
          <p className="text-stone-600 text-sm sm:text-base mt-2">
            Read how local families went from midnight caregiving panic to peaceful visits, genuine smiles, and renewed relationships.
          </p>
        </div>

        {/* Testimonial Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {testimonials.map((t, idx) => (
            <div
              key={idx}
              className="bg-white rounded-3xl p-7 border border-stone-200 shadow-md hover:shadow-xl transition-all duration-300 flex flex-col justify-between"
            >
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex gap-1 text-amber-400">
                    {[...Array(t.rating)].map((_, i) => (
                      <Star key={i} className="w-4 h-4 fill-amber-400" />
                    ))}
                  </div>
                  <Quote className="w-6 h-6 text-[#c86d51]/20" />
                </div>

                <p className="text-stone-700 text-xs sm:text-sm leading-relaxed italic font-serif">
                  “{t.quote}”
                </p>
              </div>

              <div className="pt-6 mt-6 border-t border-stone-100 flex items-center gap-3">
                <Image
                  src={t.image}
                  alt={t.author}
                  className="w-11 h-11 rounded-full object-cover ring-2 ring-stone-200" unoptimized loading="eager" width={44} height={44}
                />
                <div>
                  <div className="font-bold text-sm text-[#1e2b24]">{t.author}</div>
                  <div className="text-[11px] text-stone-600 leading-tight">{t.relationship}</div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
