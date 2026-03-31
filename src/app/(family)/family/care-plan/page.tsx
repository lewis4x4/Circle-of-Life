"use client";

import { CheckCircle2, ClipboardCheck, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function FamilyCarePlanPage() {
  return (
    <div className="space-y-4 pb-16 md:pb-0">
      <Card className="border-stone-200 bg-white text-stone-900">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">Care Summary</CardTitle>
          <CardDescription>
            Current care parameters approved by the clinical team.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <InfoPill label="Last updated" value="Today, 10:10 AM" />
          <InfoPill label="Primary nurse" value="J. Diaz, RN" />
          <InfoPill label="Care level" value="Acuity Level 3" />
          <InfoPill label="Review cadence" value="Weekly" />
        </CardContent>
      </Card>

      <SectionCard
        title="Mobility & Fall Prevention"
        points={[
          "Two-person standby assist for transfers after 8 PM.",
          "Bed alarm enabled overnight with 2-hour rounding.",
          "Non-skid footwear required during ambulation.",
        ]}
      />

      <SectionCard
        title="Medication & Monitoring"
        points={[
          "Blood pressure check before antihypertensive administration.",
          "PRN pain medication only after documented pain assessment.",
          "Hydration prompts every 2 hours while awake.",
        ]}
      />

      <SectionCard
        title="Nutrition & Activities"
        points={[
          "Heart-healthy low sodium meal profile.",
          "Morning movement group strongly encouraged.",
          "Evening calming routine and sleep hygiene support.",
        ]}
      />

      <Card className="border-stone-200 bg-white text-stone-900">
        <CardContent className="p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1 text-sm font-medium">
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              Family visibility scope
            </p>
            <Badge className="border-stone-300 bg-stone-100 text-stone-700">Read-only</Badge>
          </div>
          <p className="mb-3 text-sm text-stone-700">
            This view reflects the current signed care plan and selected operational notes approved for
            family access.
          </p>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" className="h-10 border-stone-300 bg-white text-stone-800 hover:bg-stone-50">
              <FileText className="mr-1.5 h-4 w-4" />
              Printable View
            </Button>
            <Button className="h-10 bg-orange-600 text-white hover:bg-orange-500">
              <ClipboardCheck className="mr-1.5 h-4 w-4" />
              Request Clarification
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function InfoPill({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="mt-1 text-sm font-semibold text-stone-900">{value}</p>
    </div>
  );
}

function SectionCard({ title, points }: { title: string; points: string[] }) {
  return (
    <Card className="border-stone-200 bg-white text-stone-900">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {points.map((point) => (
          <p key={point} className="inline-flex gap-2 text-sm text-stone-700">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>{point}</span>
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
