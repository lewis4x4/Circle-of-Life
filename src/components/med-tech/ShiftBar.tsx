"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Users,
  Clock,
  Bluetooth,
  Wifi,
  Battery,
  Zap,
  LogOut,
  ChevronDown,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";

export interface ShiftBarProps {
  techName: string;
  techInitials: string;
  shiftLabel: string;
  unitLabel: string;
  assignedCount: number;
  elapsedLabel: string;
}

export function ShiftBar({
  techName,
  techInitials,
  shiftLabel,
  unitLabel,
  assignedCount,
  elapsedLabel,
}: ShiftBarProps) {
  const [now, setNow] = useState(new Date());
  const [menuOpen, setMenuOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    if (menuOpen) document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [menuOpen]);

  const handleSignOut = useCallback(async () => {
    setSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }, [router]);

  const time = now.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  return (
    <div className="flex items-center justify-between px-6 py-3 border-b border-slate-800 bg-slate-950/80 backdrop-blur">
      <div className="flex items-center gap-6">
        {/* Avatar + dropdown */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="flex items-center gap-3 rounded-xl hover:bg-slate-800/60 px-1 py-0.5 transition"
            aria-label="Account menu"
          >
            <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-sky-500 flex items-center justify-center text-white font-semibold">
              {techInitials}
            </div>
            <div className="text-left">
              <div className="text-sm font-semibold text-white">{techName}</div>
              <div className="text-xs text-slate-400">
                {shiftLabel} · {unitLabel}
              </div>
            </div>
            <ChevronDown className={`w-3.5 h-3.5 text-slate-500 transition-transform ${menuOpen ? "rotate-180" : ""}`} />
          </button>

          {menuOpen && (
            <div className="absolute left-0 top-full mt-2 z-50 w-52 rounded-2xl bg-slate-900 ring-1 ring-slate-700 shadow-2xl overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800">
                <div className="text-xs font-semibold text-white truncate">{techName}</div>
                <div className="text-[11px] text-slate-500 mt-0.5">{unitLabel}</div>
              </div>
              <button
                onClick={handleSignOut}
                disabled={signingOut}
                className="w-full flex items-center gap-3 px-4 py-3 text-sm text-rose-300 hover:bg-rose-500/10 transition disabled:opacity-50"
              >
                <LogOut className="w-4 h-4" />
                {signingOut ? "Signing out…" : "Sign out"}
              </button>
            </div>
          )}
        </div>
        <div className="h-8 w-px bg-slate-800" />
        <div className="flex items-center gap-4 text-xs text-slate-400">
          <span className="flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5" /> {assignedCount} residents
          </span>
          <span className="flex items-center gap-1.5">
            <Clock className="w-3.5 h-3.5" /> {elapsedLabel} elapsed
          </span>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="text-2xl font-mono font-semibold tabular-nums text-white tracking-tight">
          {time}
        </div>
        <div className="flex items-center gap-2 text-slate-400">
          <Bluetooth className="w-4 h-4 text-sky-400" />
          <Wifi className="w-4 h-4 text-emerald-400" />
          <Battery className="w-4 h-4 text-emerald-400" />
        </div>
        <button className="group relative px-4 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-sm font-semibold shadow-lg shadow-rose-500/30 transition">
          <span className="flex items-center gap-2">
            <Zap className="w-4 h-4" /> Hold for SOS
          </span>
        </button>
      </div>
    </div>
  );
}
