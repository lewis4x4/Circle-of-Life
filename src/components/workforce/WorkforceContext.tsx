"use client";
import { createContext, useContext, useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import type { WorkforceSnapshot } from "@/lib/workforce/model";
import { cn } from "@/lib/utils";

type State = { data: WorkforceSnapshot | null; loading: boolean; error: string | null; refresh: () => void };
const Context = createContext<State>({ data: null, loading: false, error: null, refresh: () => {} });
export const useWorkforce = () => useContext(Context);
export function WorkforceContext({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const facilityId = useFacilityStore((s) => s.selectedFacilityId);
  const { appRole, organizationId, user } = useHavenAuth();
  const [state, setState] = useState<{ requestKey: string | null; data: WorkforceSnapshot | null; loading: boolean; error: string | null }>({ requestKey: null, data: null, loading: true, error: null });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => { setState((s) => ({ ...s, loading: true, error: null })); setRevision((v) => v + 1); }, []);
  const requestKey = [facilityId, organizationId, user?.id, appRole, pathname, revision].join(":");
  const allowed = ["owner", "org_admin", "facility_admin", "manager"].includes(appRole);
  useEffect(() => {
    if (!facilityId || !allowed) return;
    const controller = new AbortController();
    void fetch(`/api/admin/workforce?facility_id=${encodeURIComponent(facilityId)}`, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load Workforce.");
      if (!controller.signal.aborted) setState({ requestKey, data: body, loading: false, error: null });
    }).catch((error: unknown) => {
      if (!controller.signal.aborted) setState({ requestKey, data: null, loading: false, error: error instanceof Error ? error.message : "Could not load Workforce." });
    });
    return () => controller.abort();
  }, [facilityId, allowed, requestKey]);
  const current = state.requestKey === requestKey;
  return <Context.Provider value={{ data: allowed && current ? state.data : null, loading: allowed && !!facilityId && (!current || state.loading), error: allowed ? current ? state.error : null : "Workforce review is available to administrators and managers.", refresh }}><WorkforceLoop />{pathname.startsWith("/admin/payroll") ? <div className="mb-5 rounded-[14px] border bg-card p-4 text-sm"><p className="font-semibold">Payroll source</p><p className="mt-1 text-muted-foreground">Existing batches contain legacy time records. Kiosk timecards are reviewed separately and are not included in these exports. ADP submission is awaiting the confirmed import layout and pay rules.</p><Link href="/admin/timecards" className="mt-2 inline-block font-medium text-primary">Review kiosk timecards →</Link></div> : null}{children}</Context.Provider>;
}

function WorkforceLoop() {
  const { data } = useWorkforce();
  const path = usePathname();
  const steps = [
    { label: "Schedule", href: "/admin/schedules", detail: data ? `Next week · ${data.nextWeekStart}` : "Next week", status: data?.scheduleStatus },
    { label: "Clock", href: "/admin/staffing", detail: "Today · kiosk attendance", status: data ? data.timeclockEnabled ? "Enabled" : "Kiosk off" : null },
    { label: "Timecards", href: "/admin/timecards", detail: data ? `${data.weekStart} – ${data.weekEnd}` : "Last completed week", status: data ? `${data.people.reduce((n, p) => n + p.exceptions, 0)} to review` : null },
    { label: "Payroll", href: "/admin/payroll", detail: "Reviewed hours → ADP", status: data?.payrollStatus },
  ];
  return <nav aria-label="Workforce weekly workflow" className="mb-6 grid grid-cols-2 gap-2 xl:grid-cols-4">{steps.map((step, index) => <Link key={step.label} href={step.href} className={cn("flex min-w-0 items-start gap-3 rounded-[14px] border bg-card p-3 text-sm transition-colors hover:border-primary", path.startsWith(step.href) && "border-primary ring-2 ring-primary/15")} aria-current={path.startsWith(step.href) ? "page" : undefined}><span className="grid size-7 shrink-0 place-items-center rounded-full bg-muted font-semibold">{index + 1}</span><span className="min-w-0"><span className="block font-semibold">{step.label}</span><span className="block text-xs text-muted-foreground">{step.detail}</span>{step.status ? <span className="mt-1 block text-xs font-medium">{step.status}</span> : null}</span></Link>)}</nav>;
}
