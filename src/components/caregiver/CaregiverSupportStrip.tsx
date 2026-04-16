"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type SupportKey = "me" | "clock" | "schedules" | "policies";

const SUPPORT_LINKS: Array<{ key: SupportKey; href: string; label: string }> = [
  { key: "me", href: "/caregiver/me", label: "My profile" },
  { key: "clock", href: "/caregiver/clock", label: "Time clock" },
  { key: "schedules", href: "/caregiver/schedules", label: "My schedule" },
  { key: "policies", href: "/caregiver/policies", label: "Policies" },
];

export function CaregiverSupportStrip({
  active,
  title,
  description,
}: {
  active: SupportKey;
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.03] px-4 py-4 backdrop-blur-xl shadow-inner">
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Shift support</p>
        <h2 className="mt-1 text-base font-display font-medium text-white">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {SUPPORT_LINKS.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={cn(
                "rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors",
                isActive
                  ? "border-indigo-500/40 bg-indigo-500/15 text-indigo-200"
                  : "border-white/10 bg-black/30 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
