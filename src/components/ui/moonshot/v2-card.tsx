import React from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export function V2Card({ children, className, href, hoverColor = "indigo" }: { children: React.ReactNode; className?: string; href?: string; hoverColor?: string }) {
  const hoverGradient = {
    indigo: "group-hover:from-indigo-500/10 dark:group-hover:from-indigo-500/20",
    emerald: "group-hover:from-emerald-500/10 dark:group-hover:from-emerald-500/20",
    rose: "group-hover:from-rose-500/10 dark:group-hover:from-rose-500/20",
    orange: "group-hover:from-orange-500/10 dark:group-hover:from-orange-500/20",
    cyan: "group-hover:from-cyan-500/10 dark:group-hover:from-cyan-500/20",
    blue: "group-hover:from-blue-500/10 dark:group-hover:from-blue-500/20",
  }[hoverColor] || "group-hover:from-slate-500/10 dark:group-hover:from-slate-500/20";

  const content = (
    <div className={cn(
      "group relative h-full w-full overflow-hidden rounded-[14px] border border-slate-200 bg-white/50 backdrop-blur-md p-5 transition-all duration-300",
      "dark:border-slate-800/80 dark:bg-[#0A0A0A]/50 dark:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]",
      href && "cursor-pointer dark:hover:border-slate-600/80 hover:border-slate-300 shadow-sm",
      className
    )}>
      {/* Subtle hover backlight radial/linear gradient */}
      <div className={cn("absolute inset-0 z-0 bg-gradient-to-br via-transparent to-transparent pointer-events-none transition-opacity duration-300 opacity-0", hoverGradient)} />
      
      {/* Content wrapper */}
      <div className="relative z-10 flex h-full flex-col">
        {children}
      </div>
    </div>
  );

  if (href) {
    return <Link href={href} className="block h-full outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 rounded-[14px]">{content}</Link>;
  }
  return content;
}
