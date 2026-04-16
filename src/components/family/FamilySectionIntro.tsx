"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type FamilySectionKey = "today" | "calendar" | "care" | "messages" | "billing";

const SECTION_LINKS: Array<{ key: FamilySectionKey; href: string; label: string }> = [
  { key: "today", href: "/family", label: "Today" },
  { key: "calendar", href: "/family/calendar", label: "Calendar" },
  { key: "care", href: "/family/care-plan", label: "Care" },
  { key: "messages", href: "/family/messages", label: "Messages" },
  { key: "billing", href: "/family/billing", label: "Billing" },
];

export function FamilySectionIntro({
  active,
  title,
  description,
  residentSummary,
}: {
  active: FamilySectionKey;
  title: string;
  description: string;
  residentSummary?: string;
}) {
  return (
    <div className="w-full space-y-4">
      <div className="text-center">
        {residentSummary ? (
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-stone-400">
            For {residentSummary}
          </p>
        ) : (
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-stone-400">
            Family Portal
          </p>
        )}
        <h1 className="mt-3 text-4xl md:text-5xl font-serif text-stone-800 tracking-tight">{title}</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base text-stone-500">{description}</p>
      </div>

      <div className="flex flex-wrap justify-center gap-2">
        {SECTION_LINKS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            className={cn(
              "rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-colors",
              item.key === active
                ? "border-stone-300 bg-white text-stone-900 shadow-sm"
                : "border-stone-200 bg-white/60 text-stone-500 hover:bg-white hover:text-stone-800",
            )}
          >
            {item.label}
          </Link>
        ))}
      </div>
    </div>
  );
}
