"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Check, Clock3, Loader2, Pill, ShieldAlert, X } from "lucide-react";
import { toDate } from "date-fns-tz";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import {
  buildEmarQueueSlots,
  documentedSlotKeys,
  zonedYmd,
  type EmarQueueSlot,
} from "@/lib/caregiver/emar-queue";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type ResidentMini = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  bed_id: string | null;
};

type BedRow = { id: string; room_id: string | null; bed_label: string; current_resident_id: string | null };
type RoomRow = { id: string; room_number: string };

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"] & {
  residents: Pick<Database["public"]["Tables"]["residents"]["Row"], "first_name" | "last_name"> | null;
};

export default function CaregiverMedsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{
    facilityId: string;
    organizationId: string;
    facilityName: string | null;
    timeZone: string;
  } | null>(null);
  const [slots, setSlots] = useState<EmarQueueSlot[]>([]);
  const [actingKey, setActingKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError(
        "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local.",
      );
      setLoading(false);
      return;
    }

    try {
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }
      const { ctx: c } = resolved;
      setCtx(c);

      const medRes = await supabase
        .from("resident_medications")
        .select(
          `
          id,
          resident_id,
          facility_id,
          organization_id,
          medication_name,
          strength,
          route,
          frequency,
          scheduled_times,
          instructions,
          status,
          residents!inner ( first_name, last_name )
        `,
        )
        .eq("facility_id", c.facilityId)
        .eq("status", "active")
        .is("deleted_at", null);

      if (medRes.error) throw medRes.error;
      const raw = (medRes.data ?? []) as unknown as MedRow[];
      const medsFiltered = raw.filter((m) => m.residents != null);

      const resIds = [...new Set(medsFiltered.map((m) => m.resident_id))];
      const resById = new Map<string, ResidentMini>();
      if (resIds.length > 0) {
        const resQ = await supabase
          .from("residents")
          .select("id, first_name, last_name, bed_id")
          .in("id", resIds)
          .is("deleted_at", null);
        if (resQ.error) throw resQ.error;
        for (const r of resQ.data ?? []) {
          resById.set(r.id, r as ResidentMini);
        }
      }

      const bedIds = [...new Set([...resById.values()].map((r) => r.bed_id).filter(Boolean))] as string[];
      const roomByResident = new Map<string, string>();
      if (bedIds.length > 0) {
        const bedsQ = await supabase
          .from("beds")
          .select("id, room_id, bed_label, current_resident_id")
          .in("id", bedIds)
          .is("deleted_at", null);
        if (bedsQ.error) throw bedsQ.error;
        const beds = (bedsQ.data ?? []) as BedRow[];
        const roomIds = [...new Set(beds.map((b) => b.room_id).filter(Boolean))] as string[];
        let roomById = new Map<string, RoomRow>();
        if (roomIds.length > 0) {
          const roomsQ = await supabase.from("rooms").select("id, room_number").in("id", roomIds).is("deleted_at", null);
          if (roomsQ.error) throw roomsQ.error;
          roomById = new Map((roomsQ.data ?? []).map((r) => [r.id, r as RoomRow]));
        }
        const bedById = new Map(beds.map((b) => [b.id, b]));
        for (const [rid, res] of resById) {
          if (!res.bed_id) {
            roomByResident.set(rid, "—");
            continue;
          }
          const bed = bedById.get(res.bed_id);
          const room = bed?.room_id ? roomById.get(bed.room_id) : null;
          const label = room?.room_number
            ? `${room.room_number}${bed?.bed_label ? `-${bed.bed_label}` : ""}`
            : "—";
          roomByResident.set(rid, label);
        }
      }

      const now = new Date();
      const ymd = zonedYmd(now, c.timeZone);
      const startUtc = toDate(`${ymd}T00:00:00`, { timeZone: c.timeZone }).toISOString();
      const endUtc = toDate(`${ymd}T23:59:59.999`, { timeZone: c.timeZone }).toISOString();

      const emarQ = await supabase
        .from("emar_records")
        .select("resident_medication_id, scheduled_time, is_prn, status")
        .eq("facility_id", c.facilityId)
        .gte("scheduled_time", startUtc)
        .lte("scheduled_time", endUtc)
        .is("deleted_at", null);

      if (emarQ.error) throw emarQ.error;
      const docKeys = documentedSlotKeys(
        (emarQ.data ?? []) as {
          resident_medication_id: string;
          scheduled_time: string;
          is_prn: boolean;
          status: string;
        }[],
        c.timeZone,
        ymd,
      );

      const medInputs = medsFiltered.map((m) => {
        const res = resById.get(m.resident_id);
        const r = m.residents!;
        return {
          id: m.id,
          resident_id: m.resident_id,
          medication_name: m.medication_name,
          strength: m.strength,
          route: m.route,
          frequency: m.frequency,
          scheduled_times: (m.scheduled_times ?? []) as string[],
          instructions: m.instructions,
          resident: { first_name: res?.first_name ?? r.first_name, last_name: res?.last_name ?? r.last_name },
          roomLabel: roomByResident.get(m.resident_id) ?? "—",
        };
      });

      const built = buildEmarQueueSlots(medInputs, c.timeZone, now, docKeys);
      setSlots(built);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not load eMAR queue.");
      setSlots([]);
    } finally {
      setLoading(false);
    }
  }, [supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => {
    const dueNow = slots.filter((s) => s.urgency === "due-now").length;
    const dueSoon = slots.filter((s) => s.urgency === "due-soon").length;
    return { dueNow, dueSoon, total: slots.length };
  }, [slots]);

  async function documentDose(slot: EmarQueueSlot, status: "given" | "refused") {
    if (!ctx) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Session expired. Sign in again.");
      return;
    }

    setActingKey(slot.queueKey);
    setLoadError(null);
    try {
      const row: Database["public"]["Tables"]["emar_records"]["Insert"] = {
        resident_id: slot.residentId,
        resident_medication_id: slot.residentMedicationId,
        facility_id: ctx.facilityId,
        organization_id: ctx.organizationId,
        scheduled_time: slot.scheduledTimeIso,
        actual_time: new Date().toISOString(),
        status,
        administered_by: user.id,
        is_prn: slot.isPrn,
        created_by: user.id,
        refusal_reason: status === "refused" ? "Refused (floor documentation)" : null,
      };
      const ins = await supabase.from("emar_records").insert(row).select("id").single();
      if (ins.error) throw ins.error;
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Could not save eMAR entry.");
    } finally {
      setActingKey(null);
    }
  }

  if (configError) {
    return (
      <div className="rounded-lg border border-amber-800/60 bg-amber-950/40 px-4 py-3 text-sm text-amber-100">{configError}</div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-zinc-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading eMAR…
      </div>
    );
  }

  if (loadError && !ctx) {
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-rose-800/60 bg-rose-950/30 px-4 py-3 text-sm text-rose-100">{loadError}</div>
        <Link
          href="/caregiver"
          className="inline-flex h-11 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-sm font-medium text-zinc-200 hover:bg-zinc-800"
        >
          Back to shift home
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-gradient-to-br from-zinc-950 to-zinc-900 text-zinc-100">
        <CardHeader className="pb-2">
          <CardTitle className="text-xl font-display">eMAR Queue</CardTitle>
          <CardDescription className="text-zinc-400">
            {ctx?.facilityName ? (
              <>
                Live queue for <span className="text-zinc-200">{ctx.facilityName}</span> · times in facility timezone.
              </>
            ) : (
              "Document medication administration against active orders."
            )}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-xs">
          <MetricPill label="Due now / overdue" value={String(counts.dueNow)} tone="danger" />
          <MetricPill label="Due &lt; 90 min" value={String(counts.dueSoon)} tone="warning" />
          <MetricPill label="In window" value={String(counts.total)} tone="neutral" />
          <MetricPill label="Facility TZ" value={ctx?.timeZone?.split("/").pop() ?? "—"} tone="neutral" />
        </CardContent>
      </Card>

      {loadError ? (
        <div className="rounded-lg border border-amber-800/60 bg-amber-950/30 px-4 py-2 text-xs text-amber-100">{loadError}</div>
      ) : null}

      {slots.length === 0 ? (
        <Card className="border-zinc-800 bg-zinc-950/70 text-zinc-100">
          <CardContent className="py-8 text-center text-sm text-zinc-400">
            No medication passes in the current window. Active orders with scheduled times appear here automatically.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {slots.map((item) => (
            <MedicationCard
              key={item.queueKey}
              item={item}
              busy={actingKey === item.queueKey}
              onGiven={() => void documentDose(item, "given")}
              onRefused={() => void documentDose(item, "refused")}
            />
          ))}
        </div>
      )}
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

function MedicationCard({
  item,
  busy,
  onGiven,
  onRefused,
}: {
  item: EmarQueueSlot;
  busy: boolean;
  onGiven: () => void;
  onRefused: () => void;
}) {
  return (
    <Card
      className={`text-zinc-100 ${
        item.urgency === "due-now"
          ? "border-rose-800/70 bg-rose-950/20"
          : "border-zinc-800 bg-zinc-950/80"
      }`}
    >
      <CardContent className="p-3">
        <div className="mb-2 flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{item.medicationLabel}</p>
            <p className="mt-1 text-xs text-zinc-300">
              {item.residentName} · Rm {item.roomLabel}
            </p>
          </div>
          <Badge
            className={
              item.urgency === "due-now"
                ? "border-rose-700 bg-rose-900/40 text-rose-200"
                : "border-amber-700 bg-amber-900/40 text-amber-200"
            }
          >
            {item.urgency === "due-now" ? "Due now" : "Due soon"}
          </Badge>
        </div>

        <div className="mb-3 flex flex-wrap gap-2 text-xs text-zinc-400">
          <span className="inline-flex items-center gap-1">
            <Pill className="h-3.5 w-3.5" />
            {item.routeLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3.5 w-3.5" />
            {item.scheduleLabel}
          </span>
          <span className="inline-flex items-center gap-1">
            <ShieldAlert className="h-3.5 w-3.5" />
            {item.instructions}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Button
            type="button"
            disabled={busy}
            className="h-10 bg-emerald-600 text-white hover:bg-emerald-500 disabled:opacity-50"
            onClick={onGiven}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="mr-1.5 h-4 w-4" />}
            Given
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            className="h-10 border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800 hover:text-white disabled:opacity-50"
            onClick={onRefused}
          >
            <X className="mr-1.5 h-4 w-4" />
            Refused
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
