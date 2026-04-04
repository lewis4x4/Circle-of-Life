"use client";

import Link from "next/link";
import { ClipboardList, Pill, ShieldAlert, Stethoscope } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const links = [
  {
    href: "/admin/medications/verbal-orders",
    title: "Verbal orders",
    description: "Pending co-signatures and implementation status",
    icon: Stethoscope,
  },
  {
    href: "/admin/medications/errors",
    title: "Medication errors",
    description: "Trending and recent structured error reports",
    icon: ShieldAlert,
  },
  {
    href: "/admin/medications/errors/new",
    title: "Report an error",
    description: "New structured medication error report",
    icon: ClipboardList,
  },
  {
    href: "/admin/medications/controlled",
    title: "Controlled substances",
    description: "Shift counts, discrepancies, and signatures",
    icon: Pill,
  },
];

export default function AdminMedicationsHubPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
          Medications
        </h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Advanced medication workflows: verbal orders, error capture, and controlled substance counts.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {links.map((item) => {
          const Icon = item.icon;
          return (
            <Link key={item.href} href={item.href} className="group block">
              <Card className="h-full border-slate-200/80 shadow-soft transition-colors hover:border-brand-500/40 dark:border-slate-800">
                <CardHeader className="flex flex-row items-start gap-3 space-y-0">
                  <div className="rounded-md bg-slate-100 p-2 dark:bg-slate-900">
                    <Icon className="h-5 w-5 text-brand-600 dark:text-brand-400" />
                  </div>
                  <div>
                    <CardTitle className="font-display text-base group-hover:text-brand-700 dark:group-hover:text-brand-300">
                      {item.title}
                    </CardTitle>
                    <CardDescription className="text-xs">{item.description}</CardDescription>
                  </div>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-slate-500 dark:text-slate-400">
        Resident-level medication lists live on each{" "}
        <Link
          href="/admin/residents"
          className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}
        >
          resident profile → Medications
        </Link>
        .
      </p>
    </div>
  );
}
