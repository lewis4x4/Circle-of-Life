"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Activity, ShieldCheck, Banknote, Heart, CheckCircle2 } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { setTheme } = useTheme();

  useEffect(() => {
    // Ensure the root landing page stays in deep structural dark mode for a cinematic feel
    setTheme("dark");
  }, [setTheme]);

  return (
    <div className="flex flex-col min-h-screen bg-[#050914] text-slate-50 font-sans selection:bg-brand-500 selection:text-white overflow-hidden relative">
      
      {/* --- LAYER 1: The Deep Space Foundation & Spotlights --- */}
      <div className="absolute inset-0 z-0">
        <div className="absolute left-1/2 top-[-10%] h-[1000px] w-[1000px] -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-teal-900/40 via-[#050914]/0 to-transparent opacity-50 blur-[100px]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.03)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.03)_1px,transparent_1px)] bg-[size:3rem_3rem]" />
      </div>

      {/* --- LAYER 2: The Frosted Glass Navbar --- */}
      <nav className="fixed top-0 z-50 w-full border-b border-white/5 bg-[#050914]/60 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <div className="flex items-center gap-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/95 text-slate-900 shadow-md">
              <div className="h-3 w-3 rounded-sm bg-[#050914]" />
            </div>
            <span className="text-xl font-serif tracking-tight text-white drop-shadow-sm">Haven</span>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium text-slate-300">
            <Link href="#platform" className="hover:text-white transition-colors">Platform</Link>
            <Link href="#clinical" className="hover:text-white transition-colors">Clinical & Compliance</Link>
            <Link href="#operations" className="hover:text-white transition-colors">Multi-Entity Ops</Link>
            <Link href="#security" className="hover:text-white transition-colors">Security</Link>
          </div>

          <div className="flex items-center gap-4">
            <Link href="/login" className="text-sm font-medium text-slate-300 hover:text-white transition-colors">
              Sign In
            </Link>
            <Link href="#demo">
              <Button size="sm" className="hidden sm:flex bg-white/10 hover:bg-white/20 text-white border border-white/10 backdrop-blur tap-responsive font-medium">
                Request Access
              </Button>
            </Link>
          </div>
        </div>
      </nav>

      {/* --- LAYER 3: The Cinematic Hero Section --- */}
      <main className="relative z-10 flex flex-col items-center justify-center pt-32 pb-16 px-4 sm:px-6 text-center lg:pt-48">
        
        <div className="mb-8 inline-flex items-center rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-sm font-medium text-teal-300 backdrop-blur-sm animate-in fade-in slide-in-from-top-4 duration-700">
          <span className="mr-2 flex h-2 w-2 rounded-full bg-teal-400 animate-pulse" />
          Announcing Haven OS v1.0 <ArrowRight className="ml-2 h-4 w-4" />
        </div>

        <h1 className="mx-auto max-w-5xl text-5xl font-bold leading-[1.1] tracking-tight text-white sm:text-7xl md:text-[5.5rem] lg:leading-[1.05] drop-shadow-sm animate-in fade-in slide-in-from-top-6 duration-1000">
          The unified operations layer for <br className="hidden sm:block" />
          <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 via-emerald-300 to-teal-400 animate-gradient bg-[length:200%_auto]">
            human care.
          </span>
        </h1>
        
        <p className="mx-auto mt-8 max-w-2xl text-lg font-medium leading-relaxed text-slate-400 sm:text-xl animate-in fade-in slide-in-from-top-8 duration-1000 delay-150">
          Assisted living, home health, and community-based care operations securely governed on a single, high-precision architecture.
        </p>

        <div className="mt-10 flex flex-col sm:flex-row items-center gap-4 animate-in fade-in slide-in-from-bottom-6 duration-1000 delay-300">
          <Link href="#demo">
            <Button size="lg" className="h-14 px-8 text-base bg-white text-[#050914] hover:bg-slate-200 tap-responsive font-semibold shadow-[0_0_40px_-5px_rgba(255,255,255,0.4)]">
              Request Early Access
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
          <Link href="#architecture">
            <Button size="lg" className="h-14 px-8 text-base bg-white/10 border border-white/20 text-white hover:bg-white/20 tap-responsive font-medium backdrop-blur-md">
              Explore the Architecture
            </Button>
          </Link>
        </div>
      </main>

      {/* --- LAYER 4: The Abstract Application Mockup --- */}
      <div className="relative mx-auto mt-16 w-full max-w-6xl px-4 sm:px-6 lg:mt-24 z-20 animate-in fade-in slide-in-from-bottom-12 duration-1200 delay-500">
        <div className="absolute -inset-1 rounded-[2rem] bg-gradient-to-br from-teal-500/20 via-transparent to-emerald-500/20 opacity-50 blur-2xl" />
        
        <div className="relative rounded-2xl border border-white/10 bg-slate-900/60 shadow-2xl backdrop-blur-xl overflow-hidden"
             style={{ maskImage: "linear-gradient(to bottom, black 50%, transparent 100%)", WebkitMaskImage: "linear-gradient(to bottom, black 50%, transparent 100%)" }}>
          
          {/* OS Window Header */}
          <div className="flex items-center border-b border-white/10 bg-white/5 px-4 py-3">
            <div className="flex space-x-2">
              <div className="h-3 w-3 rounded-full bg-slate-700/60" />
              <div className="h-3 w-3 rounded-full bg-slate-700/60" />
              <div className="h-3 w-3 rounded-full bg-slate-700/60" />
            </div>
            <div className="mx-auto rounded-md bg-white/5 px-24 py-1.5 border border-white/5 hidden sm:block">
              <div className="h-2 w-32 rounded-full bg-slate-700" />
            </div>
          </div>

          {/* Abstract Dashboard Grid */}
          <div className="grid grid-cols-12 gap-6 p-6 sm:p-8 h-[400px] sm:h-[600px] opacity-80">
            {/* Sidebar Simulator */}
            <div className="col-span-3 hidden md:flex flex-col gap-4 border-r border-white/5 pr-6">
              <div className="h-6 w-24 rounded bg-slate-800 mb-4" />
              {Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="h-4 w-full rounded bg-slate-800/60" />
              ))}
              <div className="mt-auto h-12 w-full rounded-lg bg-white/5 border border-white/5" />
            </div>
            
            {/* Main Content Simulator */}
            <div className="col-span-12 md:col-span-9 flex flex-col gap-6">
              <div className="flex justify-between items-center">
                <div className="h-8 w-48 rounded bg-slate-800" />
                <div className="h-8 w-24 rounded-full bg-teal-500/20 border border-teal-500/30" />
              </div>
              
              {/* Stat Cards */}
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="h-24 rounded-xl bg-slate-800/80 border border-white/5 p-4 flex flex-col justify-between">
                    <div className="h-3 w-1/2 rounded bg-slate-700" />
                    <div className="h-6 w-3/4 rounded bg-white/20" />
                  </div>
                ))}
              </div>
              
              {/* Complex Table Simulator */}
              <div className="flex-1 rounded-xl bg-slate-800/40 border border-white/5 p-4 flex flex-col gap-3">
                <div className="h-10 border-b border-white/5 flex items-center gap-4 hidden sm:flex">
                  <div className="h-3 w-8 rounded bg-slate-700" /><div className="h-3 w-24 rounded bg-slate-700" /><div className="h-3 w-16 rounded bg-slate-700" />
                </div>
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-12 w-full rounded-lg bg-white/[0.03] flex items-center px-4 gap-4">
                    <div className="h-6 w-6 rounded-full bg-slate-700" />
                    <div className="flex-1 space-y-2">
                       <div className="h-2 w-32 rounded bg-slate-600" />
                       <div className="h-1.5 w-24 rounded bg-slate-700" />
                    </div>
                    {i === 2 && <div className="h-4 w-16 rounded-full bg-red-500/30 border border-red-500/50" />}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* --- LAYER 5: Compliance Ticker --- */}
      <div className="mt-16 sm:mt-0 border-y border-white/5 bg-white/[0.02] py-8 z-10 relative hidden sm:block">
        <div className="mx-auto flex max-w-7xl items-center justify-center gap-12 px-6 sm:px-12 opacity-60 grayscale hover:grayscale-0 transition-all duration-500">
           <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400" /><span className="text-sm font-semibold tracking-widest text-slate-300 uppercase">HIPAA Compliant</span></div>
           <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400" /><span className="text-sm font-semibold tracking-widest text-slate-300 uppercase">SOC 2 TYPE II</span></div>
           <div className="flex items-center gap-2"><CheckCircle2 className="h-5 w-5 text-emerald-400" /><span className="text-sm font-semibold tracking-widest text-slate-300 uppercase">AHCA State Ready</span></div>
           <div className="flex items-center gap-2"><ShieldCheck className="h-5 w-5 text-emerald-400" /><span className="text-sm font-semibold tracking-widest text-slate-300 uppercase">256-BIT ENCRYPTION</span></div>
        </div>
      </div>

      {/* --- LAYER 6: The B2B Enterprise "Bento Grid" --- */}
      <div className="relative z-10 mx-auto w-full max-w-7xl px-4 sm:px-6 py-24 lg:py-32">
        <div className="text-center mb-16">
          <h2 className="text-3xl font-display font-semibold tracking-tight text-white sm:text-4xl">
            A relentless focus on operational precision.
          </h2>
          <p className="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
            We stripped away the legacy bloat to build an elegant, dangerously fast system that handles everything from the bedside to the boardroom.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 md:grid-rows-[minmax(300px,_1fr)_minmax(300px,_1fr)]">
          
          {/* Card 1: Clinical (Tall) */}
          <div className="group rounded-[2rem] border border-white/5 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04] md:row-span-2 relative overflow-hidden flex flex-col justify-end">
            <div className="absolute top-8 left-8 p-3 rounded-2xl bg-teal-500/10 border border-teal-500/20 group-hover:bg-teal-500/20 transition-colors">
              <Activity className="h-6 w-6 text-teal-400" />
            </div>
            <h3 className="text-2xl font-display font-semibold text-white mt-32">Flawless Clinical Workflows</h3>
            <p className="mt-3 text-slate-400 leading-relaxed">
              Drop-dead simple eMAR, intelligent charting, and mobile-native task workflows that floor staff actually love using at 3 AM.
            </p>
            {/* Abstract visual */}
            <div className="absolute top-8 right-8 w-32 h-32 bg-teal-500/10 rounded-full blur-3xl group-hover:bg-teal-400/20 transition-colors duration-700" />
            <div className="h-1 w-1/3 bg-gradient-to-r from-teal-500 to-transparent mt-8 rounded-full" />
          </div>

          {/* Card 2: Financial (Wide) */}
          <div className="group rounded-[2rem] border border-white/5 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04] md:col-span-2 relative overflow-hidden">
            <div className="absolute top-0 right-0 p-3 rounded-bl-3xl bg-amber-500/10 border-l border-b border-white/5 group-hover:bg-amber-500/20 transition-colors">
              <Banknote className="h-6 w-6 text-amber-400" />
            </div>
            <h3 className="text-2xl font-display font-semibold text-white">Multi-Entity Ledger Control</h3>
            <p className="mt-3 text-slate-400 leading-relaxed max-w-md">
              A single pane of glass to view financials, census projections, and occupancy rates across completely separate legal LLCs and physical campuses.
            </p>
            {/* Abstract visual */}
            <div className="flex gap-2 mt-8 opacity-50 group-hover:opacity-100 transition-opacity">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="h-12 w-full max-w-[40px] rounded bg-white/5 border border-white/10 relative overflow-hidden">
                  <div className={`absolute bottom-0 w-full ${i % 2 === 0 ? 'h-3/4 bg-amber-500/30' : 'h-1/2 bg-amber-500/10'}`} />
                </div>
              ))}
            </div>
          </div>

          {/* Card 3: Security (Square) */}
          <div className="group rounded-[2rem] border border-white/5 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04] relative overflow-hidden flex flex-col justify-end">
            <div className="absolute top-8 right-8 p-3 rounded-2xl bg-slate-800 border border-white/10 group-hover:bg-slate-700 transition-colors">
              <ShieldCheck className="h-6 w-6 text-slate-300" />
            </div>
            <h3 className="text-xl font-display font-semibold text-white mt-16">Role-Governed RLS</h3>
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
              Row-Level Security hardcoded at the database layer. Caregivers see their unit, you see the empire.
            </p>
          </div>

          {/* Card 4: Family (Square) */}
          <div className="group rounded-[2rem] border border-white/5 bg-white/[0.02] p-8 transition-colors hover:bg-white/[0.04] relative overflow-hidden flex flex-col justify-end">
            <div className="absolute top-8 right-8 p-3 rounded-2xl bg-rose-500/10 border border-rose-500/20 group-hover:bg-rose-500/20 transition-colors">
              <Heart className="h-6 w-6 text-rose-400" />
            </div>
            <h3 className="text-xl font-display font-semibold text-white mt-16">Family Confidence</h3>
            <p className="mt-3 text-sm text-slate-400 leading-relaxed">
              A bespoke, hospitality-grade web portal for POA contacts and family to view care plans, invoices, and photos.
            </p>
          </div>

        </div>
      </div>
      
      {/* Footer minimal */}
      <footer className="relative border-t border-white/10 bg-[#020409] py-12 px-6 z-10">
        <div className="mx-auto flex max-w-7xl flex-col md:flex-row justify-between items-center text-sm text-slate-500">
           <div className="flex items-center gap-2 mb-4 md:mb-0">
             <div className="h-4 w-4 rounded-sm bg-white/80" />
             <span className="font-serif text-slate-300 tracking-tight">Haven OS</span>
           </div>
           <p className="text-slate-400">&copy; {new Date().getFullYear()} Circle of Life. All rights reserved.</p>
        </div>
      </footer>

    </div>
  );
}
