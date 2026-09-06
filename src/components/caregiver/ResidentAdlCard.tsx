"use client";
import { useState } from "react";
import { CheckCircle2, Clock3, Loader2, UserRound } from "lucide-react";
import { ADL_OPTIONS, ASSIST_OPTIONS } from "@/lib/caregiver/adl-form-options";
import type { ResidentWithRoom } from "@/lib/caregiver/facility-residents";
import type { Database } from "@/types/database";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function ResidentAdlCard({
  resident,
  passesToday,
  busy,
  onSubmit,
}: {
  resident: ResidentWithRoom;
  passesToday: number;
  busy: boolean;
  onSubmit: (p: {
    adlType: string;
    assistance: Database["public"]["Enums"]["assistance_level"];
    refused: boolean;
    notes: string;
  }) => Promise<boolean>;
}) {
  const [adlType, setAdlType] = useState("rounding");
  const [assistance, setAssistance] = useState<Database["public"]["Enums"]["assistance_level"]>("supervision");
  const [refused, setRefused] = useState(false);
  const [notes, setNotes] = useState("");

  const priorityClasses = "border-border bg-card shadow-sm hover:border-border";

  return (
    <div className={`p-4 md:p-5 rounded-2xl group transition-all duration-300 border  overflow-hidden relative ${priorityClasses}`}>
      <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full blur-[50px] -mr-10 -mt-10 pointer-events-none" />
      <div className="space-y-4 relative z-10 w-full">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center border border-border bg-muted text-muted-foreground">
               <UserRound className="h-5 w-5" />
            </div>
            <div>
              <p className="text-base font-semibold text-white tracking-wide">{resident.displayName}</p>
              <p className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 mt-0.5">Room {resident.roomLabel}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-1.5 shrink-0">
            <Badge
              className="rounded-full px-3 py-0.5 text-[9px] uppercase tracking-wider font-mono font-bold border border-border bg-muted text-muted-foreground"
            >
              {passesToday === 0 ? "No entries today" : `${passesToday} entries today`}
            </Badge>
            <span className="inline-flex items-center gap-1.5 text-[10px] uppercase font-mono tracking-wider text-zinc-400">
              <Clock3 className="h-3 w-3" />
              {passesToday} entr{passesToday === 1 ? "y" : "ies"} today
            </span>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 pt-2">
          <div className="space-y-1.5 focus-within:text-cyan-400 transition-colors">
            <Label className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 font-bold">ADL Type</Label>
            <select
              className="flex h-12 w-full rounded-full border border-white/10 bg-black/40 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 appearance-none font-mono"
              value={adlType}
              onChange={(e) => setAdlType(e.target.value)}
            >
              {ADL_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900 text-sm">
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5 focus-within:text-cyan-400 transition-colors">
            <Label className="text-[10px] uppercase font-mono tracking-wider text-zinc-500 font-bold">Assistance</Label>
            <select
              className="flex h-12 w-full rounded-full border border-white/10 bg-black/40 px-4 text-sm text-zinc-200 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 appearance-none font-mono"
              value={assistance}
              onChange={(e) => setAssistance(e.target.value as Database["public"]["Enums"]["assistance_level"])}
            >
              {ASSIST_OPTIONS.map((o) => (
                <option key={o.value} value={o.value} className="bg-slate-900 text-sm">
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="pt-2">
            <textarea
              rows={2}
              placeholder="Optional note (objective, brief)"
              className="w-full rounded-2xl border border-white/10 bg-black/40 px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 font-mono resize-none"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-1">
            <label className="flex items-center gap-3 text-sm text-zinc-300 shrink-0 cursor-pointer group">
              <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${refused ? 'bg-cyan-500 border-cyan-500' : 'border-zinc-600 bg-black/40 group-hover:border-cyan-500/50'}`}>
                {refused && <CheckCircle2 className="w-3.5 h-3.5 text-black" />}
              </div>
              <input
                type="checkbox"
                className="hidden"
                checked={refused}
                onChange={(e) => setRefused(e.target.checked)}
              />
              <span className="font-mono text-xs uppercase tracking-wider select-none">Resident declined care</span>
            </label>

            <Button
              type="button"
              disabled={busy}
              className={`h-12 rounded-full font-mono uppercase tracking-wider text-[10px] px-8 w-full sm:w-auto shadow-lg transition-all hover:scale-[1.02] border-0 text-zinc-950 font-bold ${refused ? 'bg-amber-400 hover:bg-amber-300 focus:ring-amber-500/50' : 'bg-cyan-400 hover:bg-cyan-300 focus:ring-cyan-500/50'}`}
              onClick={async () => {
                const saved = await onSubmit({ adlType, assistance, refused, notes });
                if (saved) setNotes((current) => current === notes ? "" : current);
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin text-zinc-950" /> : <CheckCircle2 className="mr-2 h-4 w-4 text-zinc-950" />}
              {refused ? "Log refusal" : "Log ADL Pass"}
            </Button>
        </div>
      </div>
    </div>
  );
}
