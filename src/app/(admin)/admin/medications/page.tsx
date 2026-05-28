"use client";

import Link from "next/link";
import { ArrowRight, ClipboardList, FileCheck2, Pill, ShieldAlert, Stethoscope } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const LINKS = [
  {
    href: "/admin/medications/verbal-orders",
    title: "Verbal orders",
    description: "Pending co-signatures and implementation status.",
    icon: Stethoscope,
  },
  {
    href: "/admin/medications/errors",
    title: "Error analytics",
    description: "Trending and recent structured error reports.",
    icon: ShieldAlert,
  },
  {
    href: "/admin/medications/errors/new",
    title: "Report error",
    description: "Create a new structured medication error report.",
    icon: ClipboardList,
  },
  {
    href: "/admin/medications/controlled",
    title: "Controlled substances",
    description: "Shift counts, discrepancies, and signatures.",
    icon: Pill,
  },
  {
    href: "/admin/discharge",
    title: "Medication reconciliation",
    description: "Discharge med-rec workflow — pharmacist review and sign-off.",
    icon: FileCheck2,
  },
] as const;

export default function AdminMedicationsHubPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h1 className="text-[20px] font-semibold tracking-tight text-foreground">
          Medication management
        </h1>
        <p className="max-w-2xl text-[13px] text-muted-foreground">
          Advanced medication workflows — verbal orders, error capture, and controlled-substance counts.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {LINKS.map((item) => {
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group flex flex-col gap-2 rounded-lg border border-border bg-card p-4",
                "transition-colors hover:bg-secondary/40",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              )}
            >
              <div className="flex items-center gap-2">
                <span className="grid size-7 place-items-center rounded-md bg-secondary text-foreground">
                  <Icon className="size-3.5" aria-hidden />
                </span>
                <h2 className="text-[14px] font-semibold tracking-tight text-foreground">
                  {item.title}
                </h2>
              </div>
              <p className="text-[13px] leading-relaxed text-muted-foreground">
                {item.description}
              </p>
              <span className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-muted-foreground transition-colors group-hover:text-foreground">
                Open <ArrowRight className="size-3" aria-hidden />
              </span>
            </Link>
          );
        })}
      </div>

      <div className="flex flex-col items-start gap-2 rounded-lg border border-border bg-card p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[13px] text-muted-foreground">
          Individual resident medication lists and eMAR administration records live on the resident profile.
        </p>
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 text-[12px]")}
        >
          View census
        </Link>
      </div>
    </div>
  );
}
