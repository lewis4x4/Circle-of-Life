"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Shield } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"];

type LineState = {
  med: MedRow;
  expected: number;
  actual: string;
};

export function ControlledCountConsole({
  title,
  description,
  backHref,
  backLabel,
}: {
  title: string;
  description: string;
  backHref: string;
  backLabel: string;
}) {
  const supabase = useMemo(() => createClient(), []);
  const [configError, setConfigError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [ctx, setCtx] = useState<{ facilityId: string; organizationId: string } | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [shift, setShift] = useState<Database["public"]["Enums"]["shift_type"]>("evening");
  const [saving, setSaving] = useState(false);
  const [pendingCountIds, setPendingCountIds] = useState<string[]>([]);
  const [showCoSign, setShowCoSign] = useState(false);
  const [coEmail, setCoEmail] = useState("");
  const [coPassword, setCoPassword] = useState("");
  const [coError, setCoError] = useState<string | null>(null);
  const [coBusy, setCoBusy] = useState(false);

  const loadExpected = useCallback(
    async (meds: MedRow[]) => {
      const out: LineState[] = [];
      for (const m of meds) {
        const { data: last } = await supabase
          .from("controlled_substance_counts")
          .select("actual_count, created_at")
          .eq("resident_medication_id", m.id)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        const base = last?.actual_count ?? 0;
        const since = last?.created_at ?? "1970-01-01T00:00:00Z";
        const { count, error: countError } = await supabase
          .from("emar_records")
          .select("id", { count: "exact", head: true })
          .eq("resident_medication_id", m.id)
          .eq("status", "given")
          .gte("actual_time", since);

        if (countError) {
          out.push({ med: m, expected: base, actual: String(base) });
          continue;
        }
        const given = count ?? 0;
        out.push({ med: m, expected: Math.max(0, base - given), actual: String(Math.max(0, base - given)) });
      }
      return out;
    },
    [supabase],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError("Supabase is not configured.");
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
      setCtx({ facilityId: c.facilityId, organizationId: c.organizationId });

      const medRes = await supabase
        .from("resident_medications")
        .select("*")
        .eq("facility_id", c.facilityId)
        .eq("status", "active")
        .neq("controlled_schedule", "non_controlled")
        .is("deleted_at", null);

      if (medRes.error) throw medRes.error;
      const meds = (medRes.data ?? []) as MedRow[];
      const withExpected = await loadExpected(meds);
      setLines(withExpected);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Failed to load");
      setLines([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, loadExpected]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCounts = async () => {
    if (!ctx) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Not signed in.");
      return;
    }
    setSaving(true);
    setLoadError(null);
    try {
      const today = new Date().toISOString().slice(0, 10);
      const ids: string[] = [];
      for (const line of lines) {
        const actual = Number.parseInt(line.actual, 10);
        if (Number.isNaN(actual)) {
          throw new Error(`Invalid count for ${line.med.medication_name}`);
        }
        const expected = line.expected;
        const discrepancy = actual - expected;
        const { data: inserted, error } = await supabase
          .from("controlled_substance_counts")
          .insert({
            resident_medication_id: line.med.id,
            facility_id: ctx.facilityId,
            organization_id: ctx.organizationId,
            count_date: today,
            shift,
            count_type: "shift_change",
            expected_count: expected,
            actual_count: actual,
            discrepancy,
            outgoing_staff_id: user.id,
          })
          .select("id")
          .single();
        if (error) throw error;
        if (inserted?.id) ids.push(inserted.id);
      }
      setPendingCountIds(ids);
      setShowCoSign(true);
      setCoPassword("");
      setCoError(null);
    } catch (e: unknown) {
      setLoadError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const submitCoSign = async () => {
    if (!ctx || pendingCountIds.length === 0) return;
    setCoBusy(true);
    setCoError(null);
    try {
      const res = await fetch("/api/controlled-substance/verify-co-sign", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          countIds: pendingCountIds,
          email: coEmail.trim(),
          password: coPassword,
          facilityId: ctx.facilityId,
        }),
      });
      const json = (await res.json()) as { verified?: boolean; error?: string };
      if (!res.ok || !json.verified) {
        throw new Error(json.error ?? "Verification failed");
      }
      setShowCoSign(false);
      setPendingCountIds([]);
      setCoEmail("");
      setCoPassword("");
      await load();
    } catch (e: unknown) {
      setCoError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setCoBusy(false);
    }
  };

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-white">{title}</h1>
          <p className="text-xs text-zinc-400">{description}</p>
        </div>
        <Shield className="h-6 w-6 text-teal-500" aria-hidden />
      </div>

      {configError ? <p className="text-sm text-amber-400">{configError}</p> : null}
      {loadError ? <p className="text-sm text-red-400">{loadError}</p> : null}

      {loading ? (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading…
        </div>
      ) : lines.length === 0 ? (
        <p className="text-sm text-zinc-500">No active controlled medications for this facility.</p>
      ) : (
        <>
          <div className="space-y-2">
            <Label className="text-zinc-300">Shift ending</Label>
            <select
              value={shift}
              onChange={(e) => setShift(e.target.value as Database["public"]["Enums"]["shift_type"])}
              className="w-full rounded-md border border-zinc-800 bg-zinc-950 px-3 py-2 text-sm text-white"
            >
              {(["day", "evening", "night", "custom"] as const).map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-3">
            {lines.map((line) => (
              <Card key={line.med.id} className="border-zinc-800 bg-zinc-950/80">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base text-white">{line.med.medication_name}</CardTitle>
                  <CardDescription className="text-xs text-zinc-500">
                    Expected {line.expected} (from last count minus documented doses)
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Label className="text-xs text-zinc-400">Actual count on hand</Label>
                  <Input
                    inputMode="numeric"
                    value={line.actual}
                    onChange={(e) => {
                      const value = e.target.value;
                      setLines((prev) => prev.map((x) => (x.med.id === line.med.id ? { ...x, actual: value } : x)));
                    }}
                    className="mt-1 border-zinc-800 bg-black text-white"
                  />
                </CardContent>
              </Card>
            ))}
          </div>

          <Button
            className="w-full bg-teal-700 text-white hover:bg-teal-600"
            disabled={saving}
            onClick={() => void submitCounts()}
          >
            {saving ? "Saving…" : "Sign & request co-sign"}
          </Button>
        </>
      )}

      <Link href={backHref} className="block text-center text-sm text-teal-500 hover:underline">
        {backLabel}
      </Link>

      {showCoSign ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/70 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-xl border border-zinc-800 bg-zinc-950 p-4 shadow-xl">
            <h2 className="text-lg font-semibold text-white">Incoming staff verification</h2>
            <p className="mt-1 text-xs text-zinc-400">
              Enter the incoming staff member&apos;s Haven login. This does not switch your session.
            </p>
            {coError ? <p className="mt-2 text-sm text-red-400">{coError}</p> : null}
            <div className="mt-4 space-y-3">
              <div>
                <Label className="text-zinc-300">Email</Label>
                <Input
                  type="email"
                  autoComplete="off"
                  value={coEmail}
                  onChange={(e) => setCoEmail(e.target.value)}
                  className="border-zinc-800 bg-black text-white"
                />
              </div>
              <div>
                <Label className="text-zinc-300">Password</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={coPassword}
                  onChange={(e) => setCoPassword(e.target.value)}
                  className="border-zinc-800 bg-black text-white"
                />
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                className="flex-1 border-zinc-700 text-zinc-200"
                onClick={() => {
                  setShowCoSign(false);
                  setCoPassword("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 bg-teal-700 text-white hover:bg-teal-600"
                disabled={coBusy}
                onClick={() => void submitCoSign()}
              >
                {coBusy ? "Verifying…" : "Verify & co-sign"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
