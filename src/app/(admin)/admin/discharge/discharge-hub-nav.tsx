"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function DischargeHubNav() {
  const pathname = usePathname();

  const isPipeline =
    pathname === "/admin/discharge" ||
    (pathname.startsWith("/admin/discharge/") && !pathname.startsWith("/admin/discharge/new"));

  const links = [
    { href: "/admin/discharge", label: "Pipeline", active: isPipeline },
    { href: "/admin/discharge/new", label: "New reconciliation", active: pathname.startsWith("/admin/discharge/new") },
  ] as const;

  return (
    <nav
      className="flex flex-wrap gap-1.5 w-fit rounded-full border border-slate-200/50 bg-slate-100/50 p-1.5 shadow-inner dark:border-white/5 dark:bg-black/40 backdrop-blur-3xl"
      aria-label="Discharge sections"
    >
      {links.map((item) => {
         return (
           <Link
             key={item.href}
             href={item.href}
             className={cn(
               "px-4 py-2 rounded-full text-xs font-semibold tracking-wide transition-all outline-none tap-responsive",
               item.active 
                  ? "bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm border border-slate-200/50 dark:border-white/10" 
                  : "text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200 hover:bg-white/50 dark:hover:bg-white/5"
             )}
             style={{ pointerEvents: item.active && item.href === "/admin/discharge" && pathname === "/admin/discharge" ? "none" : "auto" }}
           >
             {item.label}
           </Link>
         );
      })}
    </nav>
  );
}
