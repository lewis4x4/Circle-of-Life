"use client";

import React from "react";
import Link from "next/link";
import {
  Heart,
  Phone,
  Mail,
  MapPin,
  ShieldCheck,
  Award
} from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";

export function WebFooter() {
  return (
    <footer className="bg-[#18231d] text-[#e3ded4] pt-16 pb-12 border-t border-[#26372d]">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Tier: Brand, Mission & Emergency Contact */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-10 pb-12 border-b border-stone-800/80">
          {/* Col 1: Brand & Philosophy */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#c86d51] to-[#3d5a4c] flex items-center justify-center shadow-md">
                <Heart className="w-5 h-5 text-white fill-white/20" />
              </div>
              <div>
                <span className="text-xl font-bold text-white font-serif tracking-tight">
                  Circle of Life
                </span>
                <span className="block text-[11px] uppercase tracking-widest text-stone-400 font-medium">
                  Assisted Living Communities
                </span>
              </div>
            </div>

            <p className="text-sm leading-relaxed text-stone-300 pr-4">
              Providing non-institutional, dignity-centered assisted living across North Florida.
              Built on 50 years of craftsmanship by Milton Smith, our five sanctuaries offer loving,
              24-hour attentive care where elders age with purpose, fellowship, and joy.
            </p>

            <div className="pt-2 flex flex-wrap gap-2 text-xs">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-950/80 text-emerald-300 border border-emerald-800/60 font-medium">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                100% Citation-Free AHCA Record
              </span>
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-950/80 text-amber-300 border border-amber-800/60 font-medium">
                <Award className="w-3.5 h-3.5 text-amber-400" />
                50-Yr Master Builder Heritage
              </span>
            </div>
          </div>

          {/* Col 2: The 5 Communities */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Our 5 Communities
            </h3>
            <ul className="space-y-2 text-sm">
              {FACILITIES.map((f) => (
                <li key={f.id}>
                  <Link
                    href={`/campuses/${f.slug}`}
                    className="hover:text-white transition-colors flex items-center justify-between text-stone-300 group"
                  >
                    <span className="group-hover:text-amber-300">{f.name}</span>
                    <span className="text-[11px] text-stone-400">{f.address.city}</span>
                  </Link>
                </li>
              ))}
              <li className="pt-1">
                <Link
                  href="/campuses"
                  className="text-xs font-semibold text-emerald-400 hover:text-emerald-300 transition-colors"
                >
                  → View Regional Cartography & Map
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 3: Helpful Family Tools */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              Family Resources
            </h3>
            <ul className="space-y-2 text-sm text-stone-300">
              <li>
                <Link href="/pricing" className="hover:text-white transition-colors">
                  Transparent Pricing & VA Aid
                </Link>
              </li>
              <li>
                <Link href="/assessment-quiz" className="hover:text-white transition-colors">
                  Is It Time? 60-Sec Family Quiz
                </Link>
              </li>
              <li>
                <Link href="/care-services" className="hover:text-white transition-colors">
                  Standard Assisted Living & Respite
                </Link>
              </li>
              <li>
                <Link href="/tour" className="hover:text-white transition-colors">
                  Book a VIP Tour & Chef&apos;s Lunch
                                                  </Link>
              </li>
              <li>
                <Link href="/about" className="hover:text-white transition-colors">
                  Milton Smith & Non-Institutional Living
                </Link>
              </li>
              <li>
                <Link href="/login" className="hover:text-white transition-colors text-amber-300 font-medium">
                  Haven Family Portal Sign In
                </Link>
              </li>
            </ul>
          </div>

          {/* Col 4: 24/7 Admissions & Support */}
          <div className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-amber-400">
              24/7 Admissions & Crisis
            </h3>
            <div className="space-y-2.5 text-sm">
              <a
                href="tel:3864060887"
                className="flex items-start gap-2.5 p-3 rounded-xl bg-stone-900/90 border border-stone-800 hover:border-amber-500/50 transition-colors"
              >
                <Phone className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                <div>
                  <div className="text-xs font-bold text-white uppercase tracking-wider">
                    24/7 Admissions Line
                  </div>
                  <div className="text-base font-bold text-amber-300">(386) 406-0887</div>
                  <div className="text-[11px] text-stone-400">Immediate hospital placement triage</div>
                </div>
              </a>

              <a
                href="mailto:info@circleoflifecommunities.com"
                className="flex items-center gap-2 text-stone-300 hover:text-white transition-colors text-xs"
              >
                <Mail className="w-3.5 h-3.5 text-stone-400" />
                info@circleoflifecommunities.com
              </a>

              <div className="flex items-center gap-2 text-stone-400 text-xs">
                <MapPin className="w-3.5 h-3.5 text-stone-400" />
                Regional Headquarters: Lake City, FL
              </div>
            </div>
          </div>
        </div>

        {/* Middle Tier: Legal Entities & Florida AHCA Licenses */}
        <div className="py-8 border-b border-stone-800/80 text-xs text-stone-400 space-y-3">
          <div className="font-semibold text-stone-300 uppercase tracking-wider text-[11px]">
            Florida AHCA Licensed Facilities & Legal Entities:
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            <div className="p-2.5 rounded-lg bg-stone-900/60 border border-stone-800/80">
              <div className="font-bold text-stone-200">The Plantation on Summers</div>
              <div>The Plantation on Summers, LLC</div>
              <div className="text-amber-400/90 font-mono text-[10px]">License # AL12480 • 64 Beds</div>
              <div className="text-stone-400 text-[10px]">Columbia County</div>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-900/60 border border-stone-800/80">
              <div className="font-bold text-stone-200">Grande Cypress ALF</div>
              <div>Grande Cypress ALF, LLC</div>
              <div className="text-amber-400/90 font-mono text-[10px]">License # AL13421 • 54 Beds</div>
              <div className="text-stone-400 text-[10px]">Columbia County</div>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-900/60 border border-stone-800/80">
              <div className="font-bold text-stone-200">Rising Oaks ALF</div>
              <div>Smith & Sorensen, LLC</div>
              <div className="text-amber-400/90 font-mono text-[10px]">License # AL13041 • 52 Beds</div>
              <div className="text-stone-400 text-[10px]">Suwannee County</div>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-900/60 border border-stone-800/80">
              <div className="font-bold text-stone-200">Oakridge ALF</div>
              <div>Pine House, Inc.</div>
              <div className="text-amber-400/90 font-mono text-[10px]">License # AL9863 • 52 Beds</div>
              <div className="text-stone-400 text-[10px]">Lafayette County</div>
            </div>
            <div className="p-2.5 rounded-lg bg-stone-900/60 border border-stone-800/80">
              <div className="font-bold text-stone-200">Homewood Lodge ALF</div>
              <div>Sorensen, Smith & Bay, LLC</div>
              <div className="text-amber-400/90 font-mono text-[10px]">License # AL12528 • 36 Beds</div>
              <div className="text-stone-400 text-[10px]">Lafayette County</div>
            </div>
          </div>
        </div>

        {/* Bottom Tier: Copyright, Non-Discrimination & Equal Housing */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-stone-400">
          <p>
            © {new Date().getFullYear()} Circle of Life Assisted Living Communities. All rights
            reserved. GSMS Developers development.
          </p>
          <div className="flex items-center gap-4">
            <span>Equal Housing Opportunity</span>
            <span>•</span>
            <span>AHCA F.S. Chapter 429 Compliant</span>
            <span>•</span>
            <span>Florida Dept of Health Verified</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
