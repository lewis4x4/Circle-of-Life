"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export default function VitalThresholdsPage() {
  const params = useParams<{ id: string }>();
  const residentId = params?.id ?? "";
  const supabase = createClient();
  const [facilityId, setFacilityId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [rowId, setRowId] = useState<string | null>(null);
  const [tempHigh, setTempHigh] = useState("100.4");
  const [o2Low, setO2Low] = useState("92");
  const [pulseHigh, setPulseHigh] = useState("110");
  const [weightDelta, setWeightDelta] = useState("5");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: res } = await supabase.from("residents").select("facility_id, organization_id").eq("id", residentId).maybeSingle();
      if (!res) {
        setError("Resident not found");
        return;
      }
      setFacilityId(res.facility_id);
      setOrgId(res.organization_id);
      const { data: th } = await supabase
        .from("vital_sign_alert_thresholds")
        .select("*")
        .eq("resident_id", residentId)
        .is("deleted_at", null)
        .maybeSingle();
      if (th) {
        const t = th as Database["public"]["Tables"]["vital_sign_alert_thresholds"]["Row"];
        setRowId(t.id);
        if (t.temperature_high != null) setTempHigh(String(t.temperature_high));
        if (t.oxygen_saturation_low != null) setO2Low(String(t.oxygen_saturation_low));
        if (t.pulse_high != null) setPulseHigh(String(t.pulse_high));
        if (t.weight_change_lbs != null) setWeightDelta(String(t.weight_change_lbs));
        setNotes(t.notes ?? "");
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, residentId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!facilityId || !orgId) return;
    setSaving(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in");
        return;
      }
      const payload: Database["public"]["Tables"]["vital_sign_alert_thresholds"]["Insert"] = {
        resident_id: residentId,
        facility_id: facilityId,
        organization_id: orgId,
        temperature_high: Number.parseFloat(tempHigh) || null,
        oxygen_saturation_low: Number.parseFloat(o2Low) || null,
        pulse_high: Number.parseInt(pulseHigh, 10) || null,
        weight_change_lbs: Number.parseFloat(weightDelta) || null,
        configured_by: user.id,
        notes: notes.trim() || null,
      };
      if (rowId) {
        const { error: uErr } = await supabase
          .from("vital_sign_alert_thresholds")
          .update({
            temperature_high: payload.temperature_high,
            oxygen_saturation_low: payload.oxygen_saturation_low,
            pulse_high: payload.pulse_high,
            weight_change_lbs: payload.weight_change_lbs,
            notes: payload.notes,
          })
          .eq("id", rowId);
        if (uErr) throw uErr;
      } else {
        const { data: ins, error: iErr } = await supabase.from("vital_sign_alert_thresholds").insert(payload).select("id").single();
        if (iErr) throw iErr;
        setRowId((ins as { id: string }).id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <div>
        <Link
          href={`/admin/residents/${residentId}/vitals`}
          className={cn(buttonVariants({ variant: "link", size: "sm" }), "h-auto p-0 text-xs")}
        >
          ← Vitals
        </Link>
        <h1 className="mt-2 font-display text-2xl font-semibold tracking-tight">Alert thresholds</h1>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Per-resident limits</CardTitle>
          <CardDescription>When vitals exceed these values, alerts are generated after save (server evaluation).</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <p className="text-sm text-red-600">{error}</p>}
          {loading ? (
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          ) : (
            <>
              <div className="space-y-2">
                <Label htmlFor="th">Temp high (°F)</Label>
                <Input id="th" value={tempHigh} onChange={(e) => setTempHigh(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="o2">O₂ sat low (%)</Label>
                <Input id="o2" value={o2Low} onChange={(e) => setO2Low(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="ph">Pulse high</Label>
                <Input id="ph" value={pulseHigh} onChange={(e) => setPulseHigh(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="wt">Weight change alert (lbs in 7d)</Label>
                <Input id="wt" value={weightDelta} onChange={(e) => setWeightDelta(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="n">Notes</Label>
                <Input id="n" value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <Button type="button" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
