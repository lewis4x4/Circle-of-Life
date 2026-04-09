"use client";

import Link from "next/link";
import { ClipboardList, Pill, ShieldAlert, Stethoscope } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { V2Card } from "@/components/ui/moonshot/v2-card";
import { KineticGrid } from "@/components/ui/kinetic-grid";
import { cn } from "@/lib/utils";

const links = [
  {
    href: "/admin/medications/verbal-orders",
    title: "Verbal Orders",
    description: "Pending co-signatures and implementation status.",
    icon: Stethoscope,
    hoverColor: "indigo"
  },
  {
    href: "/admin/medications/errors",
    title: "Error Analytics",
    description: "Trending and recent structured error reports.",
    icon: ShieldAlert,
    hoverColor: "rose"
  },
  {
    href: "/admin/medications/errors/new",
    title: "Report Error",
    description: "Create a new structured medication error report.",
    icon: ClipboardList,
    hoverColor: "cyan"
  },
  {
    href: "/admin/medications/controlled",
    title: "Controlled Substances",
    description: "Shift counts, discrepancies, and signatures.",
    icon: Pill,
    hoverColor: "emerald"
  },
];

export default function AdminMedicationsHubPage() {
  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      
      {/* ─── MOONSHOT HEADER ─── */}
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm mt-4">
         <div className="space-y-2">
           <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/5 border border-slate-200 dark:border-white/10 text-[10px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 mb-2">
               SYS: Medications
           </div>
           <h1 className="font-display text-4xl md:text-5xl font-light tracking-tight text-slate-900 dark:text-white flex items-center gap-4">
              Medication Management
           </h1>
           <p className="mt-2 font-medium tracking-wide text-slate-600 dark:text-zinc-400 max-w-2xl">
             Advanced medication workflows: verbal orders, error capture, and controlled substance counts.
           </p>
         </div>
      </div>

      <KineticGrid className="grid-cols-1 md:grid-cols-2 gap-6" staggerMs={75}>
        {links.map((item) => {
          const Icon = item.icon;
          const hColor = item.hoverColor;
          
          const accentColor = {
            cyan: "text-cyan-500",
            indigo: "text-indigo-500",
            emerald: "text-emerald-500",
            rose: "text-rose-500",
          }[hColor] || "text-slate-400";

          const borderAccent = {
            cyan: "border-cyan-500/20",
            indigo: "border-indigo-500/20",
            emerald: "border-emerald-500/20",
            rose: "border-rose-500/20",
          }[hColor] || "";

          return (
            <div key={item.href} className="h-[200px]">
              <V2Card href={item.href} hoverColor={hColor} className={cn("p-8", borderAccent)}>
                <div className="flex flex-col h-full justify-between">
                  <div>
                    <div className={cn("flex items-center gap-4 mb-4", accentColor)}>
                      <div className="w-12 h-12 rounded-2xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/20 shadow-sm">
                        <Icon className="w-6 h-6" />
                      </div>
                      <h3 className="text-sm font-bold tracking-widest uppercase">{item.title}</h3>
                    </div>
                  </div>
                  <p className="text-base font-medium text-slate-600 dark:text-slate-400 leading-relaxed">
                    {item.description}
                  </p>
                </div>
              </V2Card>
            </div>
          );
        })}
      </KineticGrid>

      <div className="glass-panel mt-6 p-6 rounded-[2rem] border border-slate-200/60 dark:border-white/5 bg-slate-50/50 dark:bg-white/[0.02] flex items-center justify-between">
        <p className="text-sm font-medium text-slate-600 dark:text-zinc-400">
          Individual resident medication lists and eMAR administration records live on their profile.
        </p>
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-10 rounded-full px-6 font-bold uppercase tracking-widest text-[10px] tap-responsive bg-white dark:bg-white/5 dark:text-white border-slate-200 dark:border-white/10")}
        >
          View Census →
        </Link>
      </div>

    </div>
  );
}
