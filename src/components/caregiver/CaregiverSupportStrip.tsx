"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type SupportKey = "me" | "clock" | "schedules" | "policies";

const SUPPORT_LINKS: Array<{ key: SupportKey; href: string; label: string }> = [
  { key: "me", href: "/caregiver/me", label: "My profile" },
  { key: "clock", href: "/caregiver/clock", label: "Time clock" },
  { key: "schedules", href: "/caregiver/schedules", label: "My schedule" },
  { key: "policies", href: "/caregiver/acknowledgments?tab=policies", label: "Required reading" },
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
    <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.03] px-4 py-4  shadow-inner">
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">Shift support</p>
        <h2 className="mt-1 text-base font-medium text-white">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
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
                  ? "border-primary/40 bg-primary/15 text-primary"
                  : "border-white/10 bg-black/30 text-muted-foreground hover:border-white/20 hover:text-zinc-200",
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
