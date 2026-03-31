"use client";

import { AlertTriangle, CalendarClock, Droplets, HeartPulse, Pill, Plus, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useParams } from "next/navigation";

export default function CaregiverResidentQuickProfilePage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "unknown";

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="text-xl font-display">Margaret Johnson</CardTitle>
              <CardDescription className="text-zinc-400">
                Room 114 · Resident ID {residentId}
              </CardDescription>
            </div>
            <Badge className="border-rose-700 bg-rose-900/40 text-rose-200">High fall risk</Badge>
          </div>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="Acuity" value="Level 3" tone="danger" />
          <MetricPill label="Meds Due" value="2 now" tone="warning" />
          <MetricPill label="Open Tasks" value="3" tone="neutral" />
          <MetricPill label="Hydration" value="920 ml" tone="success" />
        </CardContent>
      </Card>

      <Card className="border-amber-900/60 bg-amber-950/20 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            Risk Banners
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Banner
            title="Falls protocol active"
            detail="Bed alarm + 2-hour rounding + toileting assist required."
            tone="warning"
          />
          <Banner
            title="Orthostatic hypotension watch"
            detail="Take seated/standing BP before antihypertensive administration."
            tone="danger"
          />
          <Banner
            title="Care plan reviewed"
            detail="Latest update accepted by nurse on current shift."
            tone="ok"
          />
        </CardContent>
      </Card>

      <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Shift Actions</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2">
          <ActionButton icon={<Pill className="h-4 w-4" />} label="Open eMAR" />
          <ActionButton icon={<CalendarClock className="h-4 w-4" />} label="ADL Task Log" />
          <ActionButton icon={<Droplets className="h-4 w-4" />} label="Add Intake" />
          <ActionButton icon={<HeartPulse className="h-4 w-4" />} label="Vitals Entry" />
        </CardContent>
      </Card>

      <Button type="button" className="h-11 w-full bg-emerald-600 text-white hover:bg-emerald-500">
        <Plus className="mr-1.5 h-4 w-4" />
        Quick Add Note
      </Button>
    </div>
  );
}

function MetricPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: "neutral" | "warning" | "danger" | "success";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/60 bg-rose-950/30"
      : tone === "warning"
        ? "border-amber-800/60 bg-amber-950/30"
        : tone === "success"
          ? "border-emerald-800/60 bg-emerald-950/30"
          : "border-zinc-800 bg-zinc-900/80";

  return (
    <div className={`rounded-xl border px-3 py-2 ${toneClass}`}>
      <p className="text-[10px] uppercase tracking-wide text-zinc-400">{label}</p>
      <p className="mt-1 text-lg font-semibold text-white">{value}</p>
    </div>
  );
}

function Banner({
  title,
  detail,
  tone,
}: {
  title: string;
  detail: string;
  tone: "warning" | "danger" | "ok";
}) {
  const toneClass =
    tone === "danger"
      ? "border-rose-800/70 bg-rose-950/20"
      : tone === "warning"
        ? "border-amber-800/70 bg-amber-950/20"
        : "border-emerald-800/60 bg-emerald-950/20";

  return (
    <div className={`rounded-lg border p-3 ${toneClass}`}>
      <p className="inline-flex items-center gap-1 text-sm font-medium text-zinc-100">
        <ShieldCheck className="h-4 w-4 text-zinc-400" />
        {title}
      </p>
      <p className="mt-1 text-xs text-zinc-400">{detail}</p>
    </div>
  );
}

function ActionButton({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <Button
      type="button"
      variant="outline"
      className="h-12 justify-start gap-2 border-zinc-800 bg-zinc-900 text-zinc-100 hover:bg-zinc-800 hover:text-white"
    >
      {icon}
      <span className="text-xs">{label}</span>
    </Button>
  );
}
