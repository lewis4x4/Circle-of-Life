"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ClipboardList, Gauge, LayoutGrid, LogOut, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/onboarding", label: "Overview", icon: Gauge },
  { href: "/onboarding/departments", label: "Departments", icon: LayoutGrid },
  { href: "/onboarding/questions", label: "Questions", icon: ClipboardList },
] as const;

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="sticky top-0 z-40 border-b border-white/10 bg-slate-950/90 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-teal-500/15 ring-1 ring-teal-400/40">
                <ShieldCheck className="h-5 w-5 text-teal-300" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.16em] text-slate-400">Haven Activation</p>
                <h1 className="font-display text-xl font-semibold tracking-tight text-white">
                  Onboarding Command Center
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="border-0 bg-amber-500/20 text-amber-100">Shared access (temporary)</Badge>
              <Link
                href="/login"
                className={cn(
                  buttonVariants({ variant: "outline", size: "sm" }),
                  "border-white/20 bg-transparent text-slate-100 hover:bg-white/10",
                )}
              >
                <LogOut className="mr-1.5 h-4 w-4" />
                Exit
              </Link>
            </div>
          </div>

          <nav className="flex flex-wrap items-center gap-2" aria-label="Onboarding sections">
            {NAV_ITEMS.map((item) => {
              const isActive =
                item.href === "/onboarding"
                  ? pathname === "/onboarding" || pathname === "/onboarding/"
                  : pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    buttonVariants({ variant: isActive ? "default" : "outline", size: "sm" }),
                    isActive
                      ? "pointer-events-none bg-teal-500 text-slate-950 hover:bg-teal-500"
                      : "border-white/20 bg-transparent text-slate-200 hover:bg-white/10",
                  )}
                >
                  <Icon className="mr-1.5 h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
