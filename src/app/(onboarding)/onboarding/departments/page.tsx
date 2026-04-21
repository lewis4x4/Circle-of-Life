import Link from "next/link";
import { ArrowRight, ClipboardList, HeartHandshake, ShieldCheck, Soup, Users } from "lucide-react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const DEPARTMENT_WORKSPACES = [
  {
    title: "Admin Assistant",
    description: "Front-desk coordination, family message triage, and daily admin queue management.",
    href: "/admin/assistant-dashboard",
    icon: ClipboardList,
    accent: "bg-amber-100 text-amber-700",
  },
  {
    title: "Coordinator",
    description: "Cross-department follow-ups, care conference coordination, and family-facing workflows.",
    href: "/admin/coordinator-dashboard",
    icon: HeartHandshake,
    accent: "bg-teal-100 text-teal-700",
  },
  {
    title: "Dietary",
    description: "Menu, meal service, diet orders, and clinical dietary review workspaces.",
    href: "/admin/dietary-dashboard",
    icon: Soup,
    accent: "bg-orange-100 text-orange-700",
  },
  {
    title: "Caregiver",
    description: "Floor workflow entrypoint for rounds, meds, incidents, clock, and shift handoff.",
    href: "/caregiver",
    icon: Users,
    accent: "bg-sky-100 text-sky-700",
  },
  {
    title: "Family Experience",
    description: "Portal and messaging surfaces that shape resident-family communication quality.",
    href: "/admin/family-portal",
    icon: ShieldCheck,
    accent: "bg-violet-100 text-violet-700",
  },
] as const;

export default function OnboardingDepartmentsPage() {
  return (
    <div className="space-y-6">
      <Card className="border-white/10 bg-white/[0.03]">
        <CardHeader>
          <CardTitle className="text-white">Departments</CardTitle>
          <CardDescription className="text-slate-400">
            Launch into the live workspace that matches each operating department.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-slate-300">
          Use this index during onboarding to validate that each department has a working destination before deeper workflow configuration begins.
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {DEPARTMENT_WORKSPACES.map((workspace) => (
          <Card key={workspace.href} className="border-white/10 bg-white/[0.03]">
            <CardHeader className="space-y-3">
              <div className={cn("inline-flex h-11 w-11 items-center justify-center rounded-xl", workspace.accent)}>
                <workspace.icon className="h-5 w-5" />
              </div>
              <div>
                <CardTitle className="text-white">{workspace.title}</CardTitle>
                <CardDescription className="pt-2 text-slate-400">
                  {workspace.description}
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <Link
                href={workspace.href}
                className={cn(
                  "group/button inline-flex h-8 w-full shrink-0 items-center justify-between rounded-lg border border-white/15 bg-white/[0.03] px-2.5 text-sm font-medium text-slate-100 transition-all outline-none hover:bg-white/[0.06]"
                )}
              >
                Open Workspace
                <ArrowRight className="h-4 w-4" />
              </Link>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
