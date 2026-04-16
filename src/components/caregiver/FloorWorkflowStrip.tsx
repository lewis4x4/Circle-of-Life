"use client";

import Link from "next/link";
import { cn } from "@/lib/utils";

type WorkflowKey = "meds" | "tasks" | "rounds" | "followups" | "prn" | "incident" | "handoff";

const WORKFLOW_LINKS: Array<{ key: WorkflowKey; href: string; label: string }> = [
  { key: "meds", href: "/caregiver/meds", label: "Medication pass" },
  { key: "tasks", href: "/caregiver/tasks", label: "ADL queue" },
  { key: "rounds", href: "/caregiver/rounds", label: "Rounds" },
  { key: "followups", href: "/caregiver/followups", label: "Condition follow-ups" },
  { key: "prn", href: "/caregiver/prn-followup", label: "PRN reassessment" },
  { key: "incident", href: "/caregiver/incident-draft", label: "Incident report" },
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
  return (
    <div className="rounded-[1.5rem] border border-white/5 bg-white/[0.03] px-4 py-4 backdrop-blur-xl shadow-inner">
      <div className="mb-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500">Floor workflow</p>
        <h2 className="mt-1 text-base font-display font-medium text-white">{title}</h2>
        <p className="mt-1 text-xs leading-relaxed text-zinc-400">{description}</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {WORKFLOW_LINKS.map((item) => {
          const isActive = item.key === active;
          return (
            <Link
              key={item.key}
              href={item.href}
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
      </div>
    </div>
  );
}
