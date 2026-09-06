"use client";
import { COUNT_RECEIPT_COLUMNS, saveControlledCountBatch, type SavedControlledCount } from "@/lib/medications/controlled-count-batch";
import { PendingCountReceipt } from "@/components/controlled-substance/PendingCountReceipt";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Loader2, Shield } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"];

type LineState = {
  id: string;
  med: MedRow;
  expected: string;
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
  const [pendingCounts, setPendingCounts] = useState<SavedControlledCount[]>([]);
  const [pendingCountIds, setPendingCountIds] = useState<string[]>([]);
  const [showCoSign, setShowCoSign] = useState(false);
  const [coEmail, setCoEmail] = useState("");
  const [coPassword, setCoPassword] = useState("");
  const [coError, setCoError] = useState<string | null>(null);
  const [coBusy, setCoBusy] = useState(false);

  const loadExpected = useCallback(async (meds: MedRow[]): Promise<LineState[]> => meds.map((med) => ({ id: crypto.randomUUID(), med, expected: "", actual: "" })), []);

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
      const { data: { user: author } } = await supabase.auth.getUser();
      if (author) {
        const pending = await supabase.from("controlled_substance_counts").select(COUNT_RECEIPT_COLUMNS).eq("facility_id", c.facilityId).eq("outgoing_staff_id", author.id).is("incoming_signed_at", null).is("deleted_at", null);
        if (pending.error) throw pending.error;
        setPendingCounts(pending.data ?? []);
        setPendingCountIds((pending.data ?? []).map((row) => row.id));
        if (pending.data?.length) setShowCoSign(true);
      }
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
    if (saving) return;
    if (pendingCountIds.length) { setShowCoSign(true); return; }
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
      const countDate = todayFacilityDateIso();
      const rows = lines.map((line) => {
        const actual = Number(line.actual);
        const expected = Number(line.expected);
        if (!line.actual.trim() || !line.expected.trim() || !Number.isInteger(actual) || !Number.isInteger(expected) || actual < 0 || expected < 0) throw new Error(`Enter independently counted actual and verified ledger expected quantities for ${line.med.medication_name}`);
        const discrepancy = actual - expected;
        return {
            id: line.id,
            resident_medication_id: line.med.id,
            facility_id: ctx.facilityId,
            organization_id: ctx.organizationId,
            count_date: countDate,
            shift,
            count_type: "shift_change",
            expected_count: expected,
            actual_count: actual,
            discrepancy,
            outgoing_staff_id: user.id,
          };
      });
      const receipt = await saveControlledCountBatch(supabase, rows);
      const ids = receipt.map((row) => row.id);
      setPendingCounts(receipt);
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
            <Label className="text-zinc-300">Count date (ET)</Label>
            <p className="text-sm text-white">{todayFacilityDateIso()}</p>
            <p className="text-xs text-zinc-500">Shift counts use today&apos;s Eastern (ET) calendar date.</p>
          </div>

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
                    Enter expected quantity from the verified inventory ledger; count actual stock independently.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Label className="text-xs text-zinc-400">Expected quantity from inventory ledger</Label><Input inputMode="numeric" value={line.expected} onChange={(e) => setLines((prev) => prev.map((x) => x.med.id === line.med.id ? { ...x, expected: e.target.value } : x))} />
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
              An independent nurse or caregiver with access to this facility must verify the saved counts. Enter their Haven login; this does not switch your session.
            </p>
            <PendingCountReceipt counts={pendingCounts} medicationNames={new Map(lines.map((line) => [line.med.id, line.med.medication_name]))} />
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
