"use client";

import Link from "next/link";
import { ArrowRight, DatabaseZap } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { SourceReadinessCallout } from "@/lib/reporting-source-readiness";

type SourceReadinessCalloutProps = {
  copy: SourceReadinessCallout;
  className?: string;
};

export function SourceReadinessCallout({
  copy,
  className,
}: SourceReadinessCalloutProps) {
  return (
    <section
      className={cn(
        "rounded-lg border border-warning/30 bg-warning/10 p-4 shadow-sm",
        className,
      )}
      aria-label={copy.title}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-warning/40 bg-background/70">
          <DatabaseZap className="h-4 w-4 text-warning" aria-hidden />
        </div>
        <div className="min-w-0 flex-1 space-y-3">
          <div className="space-y-1">
            <h2 className="text-sm font-semibold tracking-tight">{copy.title}</h2>
            <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
              {copy.description}
            </p>
          </div>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {copy.actions.map((action) => (
              <div
                key={action.href}
                className="rounded-md border border-warning/30 bg-background/80 p-3"
              >
                <p className="text-sm font-medium text-foreground">{action.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                  {action.description}
                </p>
                <Link
                  href={action.href}
                  className={cn(
                    buttonVariants({ variant: "ghost", size: "sm" }),
                    "mt-3 h-8 px-0 text-xs font-medium text-warning hover:bg-transparent hover:text-warning",
                  )}
                >
                  {action.ctaLabel}
                  <ArrowRight className="ml-1 h-3.5 w-3.5" aria-hidden />
                </Link>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
