"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { Loader2, LogOut, ShieldCheck } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { WizardSteps, WizardStep, type WizardStepState } from "@/components/ui/wizard-steps";
import { useOnboardingStore } from "@/hooks/useOnboardingStore";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

const WIZARD_STEPS = [
  { href: "/onboarding", label: "Overview" },
  { href: "/onboarding/departments", label: "Departments" },
  { href: "/onboarding/questions", label: "Questions" },
] as const;

function deriveStepState(stepHref: string, currentHref: string): WizardStepState {
  const currentIdx = WIZARD_STEPS.findIndex((s) => s.href === currentHref);
  const stepIdx = WIZARD_STEPS.findIndex((s) => s.href === stepHref);
  if (currentIdx < 0 || stepIdx < 0) return "upcoming";
  if (stepIdx < currentIdx) return "complete";
  if (stepIdx === currentIdx) return "current";
  return "upcoming";
}

function normalizePathname(pathname: string): string {
  // Treat `/onboarding/` and `/onboarding` as the same step, and any deeper
  // route under a wizard step (`/onboarding/departments/xyz`) as still on
  // that step.
  const stripped = pathname.replace(/\/$/, "") || "/";
  if (stripped === "/onboarding") return "/onboarding";
  for (const step of WIZARD_STEPS) {
    if (step.href !== "/onboarding" && stripped.startsWith(step.href)) return step.href;
  }
  return "/onboarding";
}

export function OnboardingShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [exiting, setExiting] = useState(false);
  const hydrate = useOnboardingStore((s) => s.hydrate);
  const clearAfterSignOut = useOnboardingStore((s) => s.clearAfterSignOut);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  const currentHref = normalizePathname(pathname);

  async function handleExit() {
    if (!isBrowserSupabaseConfigured()) {
      router.replace("/login");
      router.refresh();
      return;
    }
    setExiting(true);
    try {
      await supabase.auth.signOut();
      clearAfterSignOut();
      router.replace("/login");
      router.refresh();
    } finally {
      setExiting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-40 border-b border-border bg-background">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-muted ring-1 ring-border">
                <ShieldCheck className="h-5 w-5 text-primary" aria-hidden />
              </div>
              <div>
                <p className="text-[11px] uppercase tracking-wider text-muted-foreground">
                  Haven Activation
                </p>
                <h1 className="text-xl font-semibold tracking-tight text-foreground">
                  Onboarding Command Center
                </h1>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">Shared access (temporary)</Badge>
              <button
                type="button"
                disabled={exiting}
                onClick={() => void handleExit()}
                className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
                aria-label="Sign out of onboarding"
              >
                {exiting ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden />
                ) : (
                  <LogOut className="mr-1.5 h-4 w-4" aria-hidden />
                )}
                Sign out
              </button>
            </div>
          </div>

          <WizardSteps aria-label="Onboarding progress">
            {WIZARD_STEPS.map((step) => (
              <WizardStep
                key={step.href}
                label={step.label}
                href={step.href}
                state={deriveStepState(step.href, currentHref)}
              />
            ))}
          </WizardSteps>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">{children}</main>
    </div>
  );
}
