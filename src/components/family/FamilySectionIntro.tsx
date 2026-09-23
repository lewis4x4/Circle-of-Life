"use client";

import Link from "next/link";
import { FAMILY_SECTIONS, type FamilySectionKey } from "@/lib/family/family-sections";
import { cn } from "@/lib/utils";

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
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            For {residentSummary}
          </p>
        ) : (
          <p className="text-[11px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Family updates
          </p>
        )}
        <h1 className="mt-3 text-4xl md:text-5xl font-serif text-stone-800 tracking-tight">{title}</h1>
        <p className="mt-3 max-w-2xl mx-auto text-base text-muted-foreground">{description}</p>
      </div>

      {/* Same sections as the bottom tab bar (FAMILY_SECTIONS). On a phone the
          bar is always on screen, so the pills only show from md up. */}
      <nav aria-label="Family sections" className="hidden flex-wrap justify-center gap-2 md:flex">
        {FAMILY_SECTIONS.map((item) => (
          <Link
            key={item.key}
            href={item.href}
            aria-current={item.key === active ? "page" : undefined}
            className={cn(
              "rounded-full border px-4 py-2 text-[11px] font-bold uppercase tracking-[0.18em] transition-colors",
              item.key === active
                ? "border-stone-300 bg-white text-stone-900 shadow-sm"
                : "border-stone-200 bg-white/60 text-muted-foreground hover:bg-white hover:text-stone-800",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
