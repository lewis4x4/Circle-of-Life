import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function V2Card({ children, className, href, hoverColor = "indigo" }: { children: React.ReactNode; className?: string; href?: string; hoverColor?: string }) {
  const hoverGradient = {
    indigo: "group-hover:opacity-100 peer-hover:opacity-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-500/20 via-indigo-500/0 to-transparent",
    emerald: "group-hover:opacity-100 peer-hover:opacity-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-emerald-500/20 via-emerald-500/0 to-transparent",
    rose: "group-hover:opacity-100 peer-hover:opacity-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-rose-500/20 via-rose-500/0 to-transparent",
    amber: "group-hover:opacity-100 peer-hover:opacity-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-500/20 via-amber-500/0 to-transparent",
    cyan: "group-hover:opacity-100 peer-hover:opacity-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-cyan-500/20 via-cyan-500/0 to-transparent",
    blue: "group-hover:opacity-100 peer-hover:opacity-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-blue-500/20 via-blue-500/0 to-transparent",
  }[hoverColor] || "group-hover:opacity-100 peer-hover:opacity-100 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-slate-500/20 via-slate-500/0 to-transparent";

  const content = (
    <div className={cn(
      "group relative h-full w-full overflow-hidden rounded-[2rem] border border-slate-200 bg-white/60 backdrop-blur-3xl p-6 lg:p-8 transition-all duration-500",
      "dark:border-white/5 dark:bg-white/[0.015] dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.02)]",
      href && "cursor-pointer hover:-translate-y-1 hover:shadow-xl dark:hover:border-white/10 dark:hover:bg-white/[0.03]",
      className
    )}>
      {/* Massive radial bloom hover backlight */}
      <div className={cn("absolute inset-0 z-0 opacity-0 transition-opacity duration-700 pointer-events-none mix-blend-screen", hoverGradient)} />
      
      {/* Top glare / shine */}
      <div className="absolute top-0 left-1/4 right-1/4 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      
      {/* Content wrapper */}
      <div className="relative z-10 flex h-full flex-col">
        {children}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-[2rem] tap-responsive">{content}</Link>;
  }
  return content;
}
