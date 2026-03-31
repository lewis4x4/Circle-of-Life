"use client";

import React, { useEffect } from "react";
import Link from "next/link";
import { ArrowRight, Activity, ShieldCheck, Clock } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

export default function Home() {
  const { setTheme } = useTheme();

  useEffect(() => {
    // Ensure the root landing page stays in deep structural dark mode for a cinematic feel
    setTheme("dark");
  }, [setTheme]);

  return (
    <div className="flex flex-col min-h-screen bg-[#0a192f] text-slate-50 font-sans selection:bg-brand-500 selection:text-white overflow-hidden relative">
      
      {/* Cinematic Background Layer */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-[-20%] left-[-10%] w-[60%] h-[60%] rounded-full bg-brand-900/40 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[60%] h-[60%] rounded-full bg-teal-900/20 blur-[120px] pointer-events-none" />
        {/* Subtle grid pattern */}
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#1f2937_1px,transparent_1px),linear-gradient(to_bottom,#1f2937_1px,transparent_1px)] bg-[size:4rem_4rem] [mask-image:radial-gradient(ellipse_60%_50%_at_50%_50%,#000_70%,transparent_100%)] opacity-20" />
      </div>

      {/* Navigation */}
      <header className="relative z-10 py-6 px-6 lg:px-12 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-white flex items-center justify-center">
            <div className="w-4 h-4 rounded-sm bg-[#0a192f]"></div>
          </div>
          <span className="text-xl font-serif tracking-tight text-white">Haven</span>
        </div>
        <Link href="/login">
          <Button variant="ghost" className="text-white hover:text-white hover:bg-white/10 tap-responsive font-medium">
            Sign In
          </Button>
        </Link>
      </header>

      {/* Hero Section */}
      <main className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 sm:px-6 text-center animate-in fade-in slide-in-from-bottom-8 duration-700">
        <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 mb-8 backdrop-blur-md">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-xs font-medium text-slate-300 tracking-wide uppercase">System Operational</span>
        </div>

        <h1 className="text-5xl md:text-7xl font-display font-semibold tracking-tight text-white max-w-4xl mx-auto leading-[1.1]">
          The unified command center for <span className="text-transparent bg-clip-text bg-gradient-to-r from-teal-400 to-emerald-300">human care.</span>
        </h1>
        
        <p className="mt-6 text-lg md:text-xl text-slate-200 max-w-2xl mx-auto font-medium leading-relaxed">
          Assisted living, home health, and community-based care operations securely governed on a single, high-precision layer.
        </p>

        <div className="mt-12 flex items-center justify-center">
          <Link href="/login">
            <Button size="lg" className="h-14 px-10 text-lg bg-white text-[#0a192f] hover:bg-slate-200 tap-responsive font-medium shadow-[0_0_40px_-10px_rgba(255,255,255,0.3)] [&_*]:text-[#0a192f]">
              Sign In to Haven
              <ArrowRight className="ml-2 w-5 h-5" />
            </Button>
          </Link>
        </div>

        {/* Feature Micro-Indicators */}
        <div className="mt-20 grid grid-cols-1 sm:grid-cols-3 gap-8 py-8 border-t border-white/10 max-w-4xl mx-auto w-full">
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-blue-500/10 flex items-center justify-center text-blue-400">
              <Activity className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-300">Live Clinical Workflows</p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center text-emerald-400">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-300">Role-Governed Security</p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-400">
              <Clock className="w-5 h-5" />
            </div>
            <p className="text-sm font-medium text-slate-300">Real-Time Sync</p>
          </div>
        </div>
      </main>
    </div>
  );
}
