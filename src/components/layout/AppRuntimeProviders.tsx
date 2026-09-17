"use client";

import type { ReactNode } from "react";

import { MustChangePasswordGate } from "@/components/auth/MustChangePasswordGate";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

/**
 * Every authenticated route group mounts this. The forced-change gate lives here
 * rather than in HavenAuthProvider so that adding a route group cannot silently
 * opt out of it — four groups had done exactly that (COL-362).
 */
export function AppRuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={250} closeDelay={100}>
      <ServiceWorkerRegister />
      <MustChangePasswordGate>{children}</MustChangePasswordGate>
      <Toaster richColors closeButton position="bottom-right" />
    </TooltipProvider>
  );
}
