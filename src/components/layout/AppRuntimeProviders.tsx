"use client";

import type { ReactNode } from "react";

import { QueryProvider } from "@/components/layout/query-provider";
import { ServiceWorkerRegister } from "@/components/pwa/service-worker-register";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppRuntimeProviders({ children }: { children: ReactNode }) {
  return (
    <QueryProvider>
      <TooltipProvider delay={250} closeDelay={100}>
        <ServiceWorkerRegister />
        {children}
        <Toaster richColors closeButton position="bottom-right" />
      </TooltipProvider>
    </QueryProvider>
  );
}
