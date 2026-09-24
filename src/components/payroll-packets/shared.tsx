"use client";

import { useEffect } from "react";
import { registerRouteLeaveGuard } from "@/components/layout/navigation-pending";
import { useFacilityStore } from "@/hooks/useFacilityStore";

export const fieldClass = "w-full min-w-0 rounded-[var(--radius)] border border-input bg-background px-3 py-2 text-sm";
export const panelClass = "rounded-[var(--radius)] border border-border bg-card p-5";
export const hours = (minutes: number | null) => minutes == null ? "Unknown" : `${(minutes / 60).toFixed(2)} h`;
export const dollars = (cents: number | null) => cents == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
export const statusLabel = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
export async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...options, headers: { "Content-Type": "application/json", ...options?.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "The request could not be completed.");
  return data as T;
}
export function useDraftGuard(dirty: boolean, busy = false) {
  const register = useFacilityStore((state) => state.registerFacilityChangeGuard);
  useEffect(() => {
    if (!dirty && !busy) return;
    const confirm = () => !busy && window.confirm("Discard unsaved payroll changes?");
    const removeRoute = registerRouteLeaveGuard((silent) => !silent && confirm());
    const removeFacility = register(() => confirm());
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", prevent);
    return () => { removeRoute(); removeFacility(); window.removeEventListener("beforeunload", prevent); };
  }, [dirty, busy, register]);
}
