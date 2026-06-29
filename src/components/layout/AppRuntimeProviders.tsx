"use client";

import type { ReactNode } from "react";

import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppRuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delay={250} closeDelay={100}>
      <ServiceWorkerRegister />
      {children}
      <Toaster richColors closeButton position="bottom-right" />
    </TooltipProvider>
  );
}
