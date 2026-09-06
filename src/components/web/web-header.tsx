"use client";

import React, { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Phone,
  Calendar,
  ChevronDown,
  Volume2,
  VolumeX,
  Menu,
  X,
  Heart,
  ArrowRight,
  LogIn,
  Compass,
} from "lucide-react";
import { FACILITIES } from "@/lib/data/facilities-data";
import Image from "next/image";

interface WebHeaderProps {
  onOpenTourModal?: () => void;
}

export function WebHeader({ onOpenTourModal }: WebHeaderProps) {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [campusDropdownOpen, setCampusDropdownOpen] = useState(false);
  const [fontSizeLevel, setFontSizeLevel] = useState<"normal" | "large" | "xlarge">("normal");
  const [isPlayingAudio, setIsPlayingAudio] = useState(false);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("text-scale-large", "text-scale-xlarge");
    if (fontSizeLevel === "large") root.classList.add("text-scale-large");
    else if (fontSizeLevel === "xlarge") root.classList.add("text-scale-xlarge");
  }, [fontSizeLevel]);

  const toggleNatureAudio = () => {
    if (!audioElement) {
      const audio = new Audio(
        "https://cdn.pixabay.com/download/audio/2022/05/16/audio_c896502ff7.mp3?filename=birds-in-the-forest-24189.mp3"
      );
      audio.loop = true;
      audio.volume = 0.25;
      setAudioElement(audio);
      audio.play().then(() => setIsPlayingAudio(true)).catch(() => {});
    } else {
      if (isPlayingAudio) {
        audioElement.pause();
        setIsPlayingAudio(false);
      } else {
        audioElement.play().then(() => setIsPlayingAudio(true)).catch(() => {});
      }
    }
  };

  const navLinks = [
    { label: "Our 5 Communities", href: "/campuses" },
    { label: "Care & Living", href: "/care-services" },
    { label: "Pricing & VA Aid", href: "/pricing" },
    { label: "Is It Time? Quiz", href: "/assessment-quiz" },
    { label: "The Builder's Story", href: "/about" },
    { label: "Contact", href: "/contact" },
  ];

  return (
    <header className="sticky top-0 z-50 w-full shadow-md bg-[#FAF7F2]/95 backdrop-blur-md border-b border-stone-300/70">
      {/* Top Heritage & Crisis Utility Strip */}
      <div className="bg-[#1C2822] text-[#F3EFE6] text-xs py-2 px-4 sm:px-6 lg:px-8 border-b border-[#2C3E34]">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          {/* Left: 24/7 Admissions Hotline */}
          <div className="flex items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-bold text-[10px] tracking-wider uppercase border border-emerald-500/30">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              24/7 Admissions
            </span>
            <a
              href="tel:3864060887"
              className="hover:text-amber-300 transition-colors flex items-center gap-1.5 text-xs sm:text-sm font-bold tracking-wide text-white"
            >
              <Phone className="w-3.5 h-3.5 text-[#E5A952]" />
              (386) 406-0887
            </a>
            <span className="hidden md:inline text-stone-400 text-xs font-normal">
              • Mayo, Live Oak & Lake City, FL
            </span>
          </div>

          {/* Right: Audio Calming, Font Controls & Family Portal */}
          <div className="flex items-center gap-3 ml-auto text-xs">
            {/* Ambient Nature Sound */}
            <button
              onClick={toggleNatureAudio}
              className={`hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all ${
                isPlayingAudio
                  ? "bg-emerald-800/80 text-emerald-100 ring-1 ring-emerald-400"
                  : "bg-stone-800/80 text-stone-300 hover:bg-stone-700 hover:text-white"
              }`}
              title="Toggle calming front-porch nature sounds"
            >
              {isPlayingAudio ? (
                <>
                  <Volume2 className="w-3.5 h-3.5 text-emerald-300 animate-pulse" />
                  <span>Porch Breeze (Playing)</span>
                </>
              ) : (
                <>
                  <VolumeX className="w-3.5 h-3.5 text-stone-400" />
                  <span>Play Porch Sounds</span>
                </>
              )}
            </button>

            {/* Font Scaler for Aging Eyes */}
            <div className="hidden lg:flex items-center gap-1 bg-stone-800/90 rounded-full px-2 py-0.5 border border-stone-700">
              <span className="text-[10px] uppercase tracking-wider text-stone-400 font-semibold mr-1">
                Text:
              </span>
              <button
                onClick={() => setFontSizeLevel("normal")}
                className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                  fontSizeLevel === "normal"
                    ? "bg-[#E5A952] text-stone-950"
                    : "text-stone-300 hover:text-white"
                }`}
              >
                A
              </button>
              <button
                onClick={() => setFontSizeLevel("large")}
                className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                  fontSizeLevel === "large"
                    ? "bg-[#E5A952] text-stone-950"
                    : "text-stone-300 hover:text-white"
                }`}
              >
                A+
              </button>
              <button
                onClick={() => setFontSizeLevel("xlarge")}
                className={`px-1.5 py-0.5 rounded text-xs font-bold ${
                  fontSizeLevel === "xlarge"
                    ? "bg-[#E5A952] text-stone-950"
                    : "text-stone-300 hover:text-white"
                }`}
              >
                A++
              </button>
            </div>

            {/* Family & Staff Login */}
            <Link
              href="/login"
              className="inline-flex items-center gap-1 px-3 py-1 rounded-full bg-stone-800 hover:bg-stone-700 text-stone-200 text-[11px] font-semibold border border-stone-700 transition-colors"
            >
              <LogIn className="w-3 h-3 text-[#E5A952]" />
              <span>Staff & Family Portal</span>
            </Link>
          </div>
        </div>
      </div>

      {/* Main Luxury Navigation Bar */}
      <nav className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-22">
          {/* Brand Logo & Seal */}
          <Link href="/" className="flex items-center gap-3.5 group">
            <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-[#C85A32] to-[#1C2822] p-0.5 shadow-lg shadow-[#C85A32]/20 group-hover:scale-105 transition-transform duration-300">
              <div className="w-full h-full rounded-[14px] bg-[#FAF7F2] flex items-center justify-center border border-amber-200/60">
                <Heart className="w-6 h-6 text-[#A94724] fill-[#C85A32]/20" />
              </div>
            </div>
            <div className="flex flex-col">
              <span className="text-xl sm:text-2xl font-extrabold tracking-[0.08em] uppercase text-[#1C2822] font-serif group-hover:text-[#A94724] transition-colors leading-none">
                Circle of Life
              </span>
              <span className="text-[10px] sm:text-[11px] uppercase tracking-[0.25em] font-bold text-[#3D5A4C] mt-1">
                Assisted Living Communities
              </span>
            </div>
          </Link>

          {/* Desktop Navigation Links */}
          <div className="hidden lg:flex items-center gap-7 xl:gap-9">
            {/* 5-Campus Dropdown */}
            <div className="relative">
              <button
                onClick={() => setCampusDropdownOpen(!campusDropdownOpen)}
                onMouseEnter={() => setCampusDropdownOpen(true)}
                className="flex items-center gap-1.5 py-2 text-[15px] font-bold text-[#1C2822] hover:text-[#A94724] transition-colors"
              >
                <Compass className="w-4 h-4 text-[#3D5A4C]" />
                <span>Our 5 Communities</span>
                <ChevronDown
                  className={`w-4 h-4 text-stone-500 transition-transform duration-200 ${
                    campusDropdownOpen ? "rotate-180 text-[#A94724]" : ""
                  }`}
                />
              </button>

              {campusDropdownOpen && (
                <div
                  onMouseLeave={() => setCampusDropdownOpen(false)}
                  className="absolute top-full left-0 w-96 rounded-3xl bg-[#FAF7F2] shadow-2xl border-2 border-stone-200 p-4 grid gap-2 z-50 animate-in fade-in slide-in-from-top-2 duration-200"
                >
                  <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-widest text-[#3D5A4C] border-b border-stone-200 flex items-center justify-between">
                    <span>5 North Florida Sanctuaries</span>
                    <span className="text-emerald-700 font-bold">258 Licensed Beds</span>
                  </div>

                  {FACILITIES.map((facility) => (
                    <Link
                      key={facility.id}
                      href={`/campuses/${facility.slug}`}
                      onClick={() => setCampusDropdownOpen(false)}
                      className="group flex items-center gap-3 p-2.5 rounded-2xl bg-white hover:bg-stone-50 border border-stone-200/80 shadow-xs hover:shadow-md transition-all"
                    >
                      <Image
                        src={facility.image}
                        alt={facility.name}
                        className="w-12 h-12 rounded-xl object-cover ring-1 ring-stone-200 shrink-0" unoptimized loading="eager" width={48} height={48}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="font-bold text-xs sm:text-sm text-[#1C2822] group-hover:text-[#A94724] transition-colors truncate">
                          {facility.name}
                        </div>
                        <div className="text-[11px] text-stone-500 flex items-center gap-1.5 mt-0.5">
                          <span>{facility.address.city}, FL</span>
                          <span>•</span>
                          <span className="text-emerald-700 font-semibold">{facility.availableBeds} Suites Available</span>
                        </div>
                      </div>
                    </Link>
                  ))}

                  <div className="pt-2 border-t border-stone-200 mt-1">
                    <Link
                      href="/campuses"
                      onClick={() => setCampusDropdownOpen(false)}
                      className="flex items-center justify-center gap-2 py-2.5 text-xs font-bold text-white bg-[#1C2822] hover:bg-stone-800 rounded-xl transition-colors shadow-sm"
                    >
                      <span>Explore Regional Map & Compare</span>
                      <ArrowRight className="w-3.5 h-3.5 text-amber-300" />
                    </Link>
                  </div>
                </div>
              )}
            </div>

            {navLinks.slice(1).map((link) => {
              const isActive = pathname === link.href;
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`text-[15px] font-bold transition-colors py-2 relative ${
                    isActive
                      ? "text-[#A94724]"
                      : "text-[#1C2822] hover:text-[#A94724]"
                  }`}
                >
                  {link.label}
                  {isActive && (
                    <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-[#C85A32] rounded-full" />
                  )}
                </Link>
              );
            })}
          </div>

          {/* Desktop Primary Action CTA */}
          <div className="hidden lg:flex items-center gap-3">
            <Link
              href="/tour"
              onClick={onOpenTourModal}
              className="inline-flex items-center justify-center gap-2 px-6 py-3.5 rounded-2xl bg-gradient-to-r from-[#C85A32] to-[#B34E28] text-white font-bold text-sm shadow-lg shadow-[#C85A32]/30 hover:scale-[1.02] active:scale-[0.98] transition-all border border-amber-300/30"
            >
              <Calendar className="w-4 h-4 text-amber-200" />
              <span>Schedule a VIP Visit</span>
            </Link>
          </div>

          {/* Mobile Menu Button */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <Link
              href="/tour"
              onClick={onOpenTourModal}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[#B34E28] text-white text-xs font-bold shadow-md"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Tour</span>
            </Link>

            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-2 rounded-xl text-[#1C2822] hover:bg-stone-200 transition-colors"
              aria-label="Toggle Navigation Menu"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="lg:hidden border-t border-stone-200 bg-[#FAF7F2] px-4 pt-3 pb-8 animate-in fade-in slide-in-from-top-4 duration-200">
          <div className="grid gap-2">
            <div className="font-bold text-xs uppercase tracking-widest text-[#3D5A4C] px-3 py-1">
              Our 5 Communities
            </div>
            <div className="grid gap-1.5 pl-2">
              {FACILITIES.map((facility) => (
                <Link
                  key={facility.id}
                  href={`/campuses/${facility.slug}`}
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-bold text-[#1C2822] bg-white border border-stone-200"
                >
                  <span>{facility.name}</span>
                  <span className="text-[11px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded-full">
                    {facility.address.city}
                  </span>
                </Link>
              ))}
            </div>

            <div className="my-3 border-t border-stone-200" />

            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setMobileMenuOpen(false)}
                className="px-3 py-2.5 rounded-xl text-base font-bold text-[#1C2822] hover:bg-stone-200/60"
              >
                {link.label}
              </Link>
            ))}

            <div className="pt-4 border-t border-stone-200 grid gap-2.5">
              <a
                href="tel:3864060887"
                className="flex items-center justify-center gap-2 py-3.5 rounded-2xl bg-[#1C2822] text-white font-bold text-sm"
              >
                <Phone className="w-4 h-4 text-amber-400" />
                <span>Call 24/7 Admissions: (386) 406-0887</span>
              </a>
              <Link
                href="/login"
                onClick={() => setMobileMenuOpen(false)}
                className="flex items-center justify-center gap-2 py-3 rounded-2xl border-2 border-stone-300 text-stone-700 font-bold text-sm"
              >
                <LogIn className="w-4 h-4 text-[#A94724]" />
                <span>Staff & Family Portal Sign In</span>
              </Link>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}
