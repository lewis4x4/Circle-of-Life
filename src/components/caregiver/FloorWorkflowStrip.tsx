"use client";

import Link from "next/link";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getAppRoleFromClaims } from "@/lib/auth/app-role";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { cn } from "@/lib/utils";

type WorkflowKey = "meds" | "tasks" | "rounds" | "followups" | "prn" | "incident" | "handoff";

const WORKFLOW_LINKS: Array<{ key: WorkflowKey; href: string; label: string }> = [
  { key: "meds", href: "/caregiver/meds", label: "Medication pass" },
  { key: "tasks", href: "/caregiver/tasks", label: "ADL queue" },
  { key: "rounds", href: "/caregiver/rounds", label: "Rounds" },
  { key: "followups", href: "/caregiver/followups", label: "Condition follow-ups" },
  { key: "prn", href: "/caregiver/prn-followup", label: "PRN reassessment" },
  { key: "incident", href: "/caregiver/report", label: "Something happened" },
  { key: "handoff", href: "/caregiver/handoff", label: "Shift handoff" },
];

export function FloorWorkflowStrip({
  active,
  title,
  description,
}: {
  active: WorkflowKey;
  title: string;
  description: string;
}) {
  const { appRole, user, loading } = useHavenAuth();
  const effectiveRole = getAppRoleFromClaims(user) || (loading ? "" : appRole);
  const homeHref = effectiveRole ? getDashboardRouteForRole(effectiveRole) : null;

  return (
    // On a phone the strip is one swipeable row under the title: the advice
    // sentence and the wrapped pill grid pushed the first work item below the
    // fold (COL-657). From sm up it is the full panel.
    <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.03] px-3 py-3 shadow-inner sm:px-4 sm:py-4">
      <div className="mb-2 sm:mb-3">
        <p className="hidden text-xs font-medium text-muted-foreground sm:block">Floor workflow</p>
        <h2 className="text-base font-medium text-white sm:mt-1">{title}</h2>
        <p className="mt-1 hidden text-xs leading-relaxed text-zinc-400 sm:block">{description}</p>
      </div>
      <nav
        aria-label="Floor workflows"
        className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0 [&>*]:shrink-0 [&>*]:whitespace-nowrap"
      >
        {homeHref ? (
          <Link
            href={homeHref}
            className="rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-200 transition-colors hover:border-emerald-400/60 hover:bg-emerald-500/20"
          >
            Shift home
          </Link>
        ) : (
          <span className="rounded-full border border-white/10 bg-black/30 px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] text-zinc-500">
            Resolving home
          </span>
        )}
        {WORKFLOW_LINKS.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "rounded-full border px-3 py-2 text-[10px] font-bold uppercase tracking-[0.18em] transition-colors",
                isActive
                  ? "border-cyan-500/40 bg-cyan-500/15 text-cyan-200"
                  : "border-white/10 bg-black/30 text-zinc-400 hover:border-white/20 hover:text-zinc-200",
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
