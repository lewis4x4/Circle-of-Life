"use client";
import { COUNT_RECEIPT_COLUMNS, saveControlledCountBatch, type SavedControlledCount } from "@/lib/medications/controlled-count-batch";
import { PendingCountReceipt } from "@/components/controlled-substance/PendingCountReceipt";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Loader2, Shield } from "lucide-react";

import { loadCaregiverFacilityContext } from "@/lib/caregiver/facility-context";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient, isBrowserSupabaseConfigured } from "@/lib/supabase/client";
import type { Database } from "@/types/database";
import { formatResidentIdentity, formatMedicationDose, requireControlledMedicationResidentIdentities, usePendingCountIdentities, type ResidentIdentity } from "@/lib/medications/controlled-count-identity";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type MedRow = Database["public"]["Tables"]["resident_medications"]["Row"];

type ControlledMedication = MedRow & { residents: ResidentIdentity | null };

type LineState = {
  id: string;
  med: ControlledMedication;
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
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const loadGeneration = useRef(0);
  const receiptIdentity = usePendingCountIdentities(supabase, ctx?.facilityId ?? null, pendingCounts);

  const loadExpected = useCallback(async (meds: ControlledMedication[]): Promise<LineState[]> => meds.map((med) => ({ id: crypto.randomUUID(), med, expected: "", actual: "" })), []);

  const load = useCallback(async () => {
    const generation = ++loadGeneration.current;
    setLoading(true);
    setSaveError(null);
    setCtx(null);
    setLines([]);
    setPendingCounts([]);
    setPendingCountIds([]);
    setShowCoSign(false);
    setLoadError(null);
    setConfigError(null);
    if (!isBrowserSupabaseConfigured()) {
      setConfigError("Supabase is not configured.");
      setLoading(false);
      return;
    }
    try {
      const resolved = await loadCaregiverFacilityContext(supabase);
      if (generation !== loadGeneration.current) return;
      if (!resolved.ok) {
        setLoadError(resolved.error);
        setLoading(false);
        return;
      }
      const { ctx: c } = resolved;
      setCtx({ facilityId: c.facilityId, organizationId: c.organizationId });

      const medRes = await supabase
        .from("resident_medications")
        .select("*, residents!resident_medications_resident_id_fkey(first_name, middle_name, last_name, name_suffix, preferred_name)")
        .eq("facility_id", c.facilityId)
        .eq("status", "active")
        .neq("controlled_schedule", "non_controlled")
        .is("deleted_at", null);

      if (generation !== loadGeneration.current) return;
      if (medRes.error) throw medRes.error;
      const meds = (medRes.data ?? []) as ControlledMedication[];
      requireControlledMedicationResidentIdentities(meds);
      const withExpected = await loadExpected(meds);
      if (generation !== loadGeneration.current) return;
      setLines(withExpected);
      const { data: { user: author } } = await supabase.auth.getUser();
      if (author) {
        const pending = await supabase.from("controlled_substance_counts").select(COUNT_RECEIPT_COLUMNS).eq("facility_id", c.facilityId).eq("outgoing_staff_id", author.id).is("incoming_signed_at", null).is("deleted_at", null);
        if (generation !== loadGeneration.current) return;
        if (pending.error) throw pending.error;
        setPendingCounts(pending.data ?? []);
        setPendingCountIds((pending.data ?? []).map((row) => row.id));
        if (pending.data?.length) setShowCoSign(true);
      }
    } catch (e: unknown) {
      if (generation !== loadGeneration.current) return;
      setLoadError(e instanceof Error ? e.message : "Failed to load");
      setLines([]);
    } finally {
      if (generation === loadGeneration.current) setLoading(false);
    }
  }, [supabase, loadExpected]);

  useEffect(() => {
    void load();
    return () => { loadGeneration.current += 1; };
  }, [load]);

  const submitCounts = async () => {
    if (saving || loading) return;
    if (pendingCountIds.length) { setShowCoSign(true); return; }
    if (loadError || !lines.length) return;
    const generation = loadGeneration.current;
    if (!ctx) return;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Not signed in.");
      return;
    }
    if (generation !== loadGeneration.current) return;
    setSaving(true);
    setSaveError(null);
    try {
      requireControlledMedicationResidentIdentities(lines.map((line) => line.med));
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
      if (generation !== loadGeneration.current) return;
      const ids = receipt.map((row) => row.id);
      setPendingCounts(receipt);
      setPendingCountIds(ids);
      setShowCoSign(true);
      setCoPassword("");
      setCoError(null);
    } catch (e: unknown) {
      if (generation === loadGeneration.current) setSaveError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const submitCoSign = async () => {
    if (!ctx || coBusy || !receiptIdentity.ready || pendingCountIds.length === 0) return;
    const generation = loadGeneration.current;
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
      if (generation !== loadGeneration.current) return;
      if (!res.ok || !json.verified) {
        throw new Error(json.error ?? "Verification failed");
      }
      setShowCoSign(false);
      setPendingCountIds([]);
      setCoEmail("");
      setCoPassword("");
      await load();
    } catch (e: unknown) {
      if (generation === loadGeneration.current) setCoError(e instanceof Error ? e.message : "Verification failed");
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
      {saveError ? <p role="alert" className="text-sm text-red-400">{saveError}</p> : null}
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
                    <span className="block">Resident: {formatResidentIdentity(line.med.residents)}</span>
                    <span className="block">Dose: {formatMedicationDose(line.med)}</span>
                    <span className="block">Medication record: {line.med.id}</span>
                    <span className="mt-1 block">Enter expected quantity from the verified inventory ledger; count actual stock independently.</span>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Label className="text-xs text-zinc-400">Expected quantity from inventory ledger</Label><Input aria-label="Expected quantity from inventory ledger" inputMode="numeric" value={line.expected} onChange={(e) => setLines((prev) => prev.map((x) => x.med.id === line.med.id ? { ...x, expected: e.target.value } : x))} />
                  <Label className="text-xs text-zinc-400">Actual count on hand</Label>
                  <Input
                    aria-label="Actual count on hand"
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
            disabled={saving || loading || Boolean(loadError)}
            onClick={() => void submitCounts()}
          >
            {saving ? "Saving…" : "Sign & request co-sign"}
          </Button>
        </>
      )}

      {pendingCountIds.length > 0 && !showCoSign ? <Button onClick={() => setShowCoSign(true)}>Resume saved count verification</Button> : null}

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
            <PendingCountReceipt counts={pendingCounts} medicationLabels={receiptIdentity.labels} />
            {!receiptIdentity.ready && !receiptIdentity.error ? <p role="status">Resolving saved count identities…</p> : null}
            {receiptIdentity.error ? <div role="alert"><p>{receiptIdentity.error}</p><Button variant="outline" onClick={receiptIdentity.retry}>Retry identity lookup</Button></div> : null}
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
                disabled={coBusy || !receiptIdentity.ready}
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
