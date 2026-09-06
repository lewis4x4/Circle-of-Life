"use client";
import { COUNT_RECEIPT_COLUMNS, saveControlledCountBatch, type SavedControlledCount } from "@/lib/medications/controlled-count-batch";
import { PendingCountReceipt } from "@/components/controlled-substance/PendingCountReceipt";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Shield, ChevronDown, Loader2, AlertTriangle } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/client";

type MedRow = {
  id: string;
  medication_name: string;
  resident_id: string;
  resident_first_name: string;
  resident_last_name: string;
  room?: string | null;
};

type ResidentMedicationQueryRow = {
  id: string;
  medication_name: string;
  resident_id: string;
  residents: {
    first_name: string | null;
    last_name: string | null;
    bed_id: string | null;
    beds: {
      room_id: string | null;
      rooms: {
        room_number: string | null;
      } | null;
    } | null;
  } | null;
};

type LineState = {
  id: string;
  med: MedRow;
  expected: string;
  actual: string;
};

export interface CountInitiationModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  facilityId: string;
  onSuccess?: () => void;
}

const SHIFTS = ["day", "evening", "night", "custom"] as const;
type Shift = (typeof SHIFTS)[number];

export function CountInitiationModal({
  open,
  onOpenChange,
  facilityId,
  onSuccess,
}: CountInitiationModalProps) {
  const supabase = useMemo(() => createClient(), []);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [lines, setLines] = useState<LineState[]>([]);
  const [shift, setShift] = useState<Shift>("evening");
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
    if (!open || !facilityId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const medRes = await supabase
        .from("resident_medications")
        .select(`
          id,
          medication_name,
          resident_id,
          residents!inner (
            first_name,
            last_name,
            bed_id,
            beds!inner (
              room_id,
              rooms!inner (
                room_number
              )
            )
          )
        `)
        .eq("facility_id", facilityId)
        .eq("status", "active")
        .neq("controlled_schedule", "non_controlled")
        .is("deleted_at", null);

      if (medRes.error) throw medRes.error;

      const meds = ((medRes.data ?? []) as ResidentMedicationQueryRow[]).map((row) => ({
        id: row.id,
        medication_name: row.medication_name,
        resident_id: row.resident_id,
        resident_first_name: row.residents?.first_name || "",
        resident_last_name: row.residents?.last_name || "",
        room: row.residents?.beds?.rooms?.room_number || null,
      })) as MedRow[];

      const withExpected = await loadExpected(meds);
      setLines(withExpected);
      const { data: { user: author } } = await supabase.auth.getUser();
      if (author) {
        const pending = await supabase.from("controlled_substance_counts").select(COUNT_RECEIPT_COLUMNS).eq("facility_id", facilityId).eq("outgoing_staff_id", author.id).is("incoming_signed_at", null).is("deleted_at", null);
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
  }, [open, facilityId, supabase, loadExpected]);

  useEffect(() => {
    void load();
  }, [load]);

  const submitCounts = async () => {
    if (saving) return;
    if (pendingCountIds.length) { setShowCoSign(true); return; }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("Not signed in.");
      return;
    }
    setSaving(true);
    setLoadError(null);
    try {
      const { data: profile } = await supabase
        .from("user_profiles")
        .select("organization_id")
        .eq("id", user.id)
        .single();

      if (!profile?.organization_id) {
        throw new Error("Could not determine organization");
      }

      const countOrganizationId = profile.organization_id;
      const today = todayFacilityDateIso();
      const rows = lines.map((line) => {
        const actual = Number(line.actual);
        const expected = Number(line.expected);
        if (!line.actual.trim() || !line.expected.trim() || !Number.isInteger(actual) || !Number.isInteger(expected) || actual < 0 || expected < 0) throw new Error(`Enter independently counted actual and verified ledger expected quantities for ${line.med.medication_name}`);
        const discrepancy = actual - expected;
        return {
            id: line.id,
            resident_medication_id: line.med.id,
            facility_id: facilityId,
            organization_id: countOrganizationId,
            count_date: today,
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
          facilityId,
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
      onSuccess?.();
      onOpenChange(false);
    } catch (e: unknown) {
      setCoError(e instanceof Error ? e.message : "Verification failed");
    } finally {
      setCoBusy(false);
    }
  };

  const handleClose = () => {
    if (!showCoSign && !saving) {
      setLines([]);
      setLoadError(null);
      onOpenChange(false);
    }
  };

  const hasDiscrepancies = lines.some(
    (l) => Number.parseInt(l.actual, 10) !== Number(l.expected)
  );

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto border-emerald-900/50 text-zinc-100">
        {!showCoSign ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg text-emerald-200 font-semibold">
                <Shield className="h-5 w-5 text-emerald-400" />
                Initiate Controlled Substance Count
              </DialogTitle>
              <DialogDescription className="text-emerald-200/70">
                Count all controlled medications for the shift ending.
              </DialogDescription>
            </DialogHeader>

            {loadError ? (
              <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-200 flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                {loadError}
              </div>
            ) : loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-emerald-400" />
              </div>
            ) : lines.length === 0 ? (
              <div className="text-center py-8">
                <Shield className="h-12 w-12 text-zinc-600 mx-auto mb-3" />
                <p className="text-zinc-400">No active controlled medications at this facility.</p>
              </div>
            ) : (
              <>
                <div className="space-y-2 mb-4">
                  <Label htmlFor="count-date" className="text-xs text-emerald-200/80">
                    Count date (ET)
                  </Label>
                  <Input
                    id="count-date"
                    type="date"
                    readOnly
                    value={todayFacilityDateIso()}
                    className="h-12 border-emerald-900/50 bg-zinc-950 px-4 text-sm text-zinc-100"
                  />
                </div>

                {/* Shift Selection */}
                <div className="space-y-2 mb-4">
                  <Label className="text-xs text-emerald-200/80">Shift ending</Label>
                  <div className="relative">
                    <select
                      value={shift}
                      onChange={(e) => setShift(e.target.value as Shift)}
                      className="w-full h-12 appearance-none rounded-lg border border-emerald-900/50 bg-zinc-950 px-4 text-sm text-zinc-100 focus:ring-2 focus:ring-emerald-500/50"
                    >
                      {SHIFTS.map((s) => (
                        <option key={s} value={s}>
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500 pointer-events-none" />
                  </div>
                </div>

                {/* Medication List */}
                <div className="space-y-3 max-h-[400px] overflow-y-auto pr-2">
                  {lines.map((line) => {
                    const actual = Number.parseInt(line.actual, 10);
                    const isDiscrepant = !Number.isNaN(actual) && actual !== Number(line.expected);
                    return (
                      <Card
                        key={line.med.id}
                        className={cn(
                          "border-emerald-900/30 bg-zinc-950/80",
                          isDiscrepant && "border-rose-500/30 bg-rose-950/20"
                        )}
                      >
                        <CardHeader className="pb-2">
                          <CardTitle className="text-base text-white flex justify-between items-start">
                            <span>{line.med.medication_name}</span>
                            {isDiscrepant && (
                              <span className="text-rose-400 text-sm font-bold">
                                {actual > Number(line.expected) ? "+" : ""}
                                {actual - Number(line.expected)}
                              </span>
                            )}
                          </CardTitle>
                          <CardDescription className="text-xs text-zinc-500">
                            {line.med.resident_first_name} {line.med.resident_last_name}
                            {line.med.room && ` · Room ${line.med.room}`}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="flex items-center gap-4">
                          <div className="flex-1">
                            <Label className="text-[10px] text-zinc-400">Expected</Label>
                            <Input aria-label="Expected quantity from inventory ledger" inputMode="numeric" value={line.expected} onChange={(e) => setLines((prev) => prev.map((x) => x.med.id === line.med.id ? { ...x, expected: e.target.value } : x))} />
                          </div>
                          <div className="flex-1">
                            <Label className="text-[10px] text-zinc-400">Actual</Label>
                            <Input
                              type="number"
                              inputMode="numeric"
                              value={line.actual}
                              onChange={(e) => {
                                const v = e.target.value;
                                setLines((prev) =>
                                  prev.map((x) =>
                                    x.med.id === line.med.id ? { ...x, actual: v } : x
                                  )
                                );
                              }}
                              className={cn(
                                "h-12 border-emerald-900/50 bg-black text-white",
                                isDiscrepant && "border-rose-500/50"
                              )}
                            />
                          </div>
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>

                <p className="text-sm text-zinc-300">Expected quantity must come from the verified medication inventory ledger. Count actual stock independently before requesting the incoming signature.</p>
                {/* Discrepancy Warning */}
                {hasDiscrepancies && (
                  <div className="rounded-lg border border-amber-500/30 bg-amber-950/30 px-4 py-3 text-sm text-amber-200 flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="font-medium">Discrepancy detected</p>
                      <p className="text-amber-200/70 mt-1">
                        Actual counts do not match expected values. This will trigger an alert to administration.
                      </p>
                    </div>
                  </div>
                )}

                <DialogFooter className="gap-3">
                  <Button
                    variant="outline"
                    onClick={handleClose}
                    disabled={saving}
                    className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={submitCounts}
                    disabled={saving}
                    className="bg-emerald-700 text-white hover:bg-emerald-600"
                  >
                    {saving ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      "Sign & Request Co-Sign"
                    )}
                  </Button>
                </DialogFooter>
              </>
            )}
          </>
        ) : (
          /* Co-Sign Verification */
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2 text-lg text-emerald-200 font-semibold">
                <Shield className="h-5 w-5 text-emerald-400" />
                Incoming Staff Verification
              </DialogTitle>
              <DialogDescription className="text-emerald-200/70">
                An independent nurse or caregiver with facility access must verify the saved count to complete the record.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              <PendingCountReceipt counts={pendingCounts} medicationNames={new Map(lines.map((line) => [line.med.id, line.med.medication_name]))} />
              {coError && (
                <div className="rounded-lg border border-rose-900/50 bg-rose-950/30 px-4 py-3 text-sm text-rose-200 flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  {coError}
                </div>
              )}

              <div className="space-y-2">
                <Label className="text-xs text-emerald-200/80">Incoming staff email</Label>
                <Input
                  type="email"
                  autoComplete="off"
                  value={coEmail}
                  onChange={(e) => setCoEmail(e.target.value)}
                  className="border-emerald-900/50 bg-black text-white"
                />
              </div>

              <div className="space-y-2">
                <Label className="text-xs text-emerald-200/80">Password</Label>
                <Input
                  type="password"
                  autoComplete="off"
                  value={coPassword}
                  onChange={(e) => setCoPassword(e.target.value)}
                  className="border-emerald-900/50 bg-black text-white"
                />
              </div>

              <p className="text-xs text-zinc-500">
                This verifies the incoming staff member&apos;s credentials without switching sessions.
              </p>
            </div>

            <DialogFooter className="gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  setShowCoSign(false);
                  setCoPassword("");
                }}
                disabled={coBusy}
                className="border-zinc-700 text-zinc-300 hover:bg-zinc-800"
              >
                Cancel
              </Button>
              <Button
                onClick={submitCoSign}
                disabled={coBusy}
                className="bg-emerald-700 text-white hover:bg-emerald-600"
              >
                {coBusy ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Verifying...
                  </>
                ) : (
                  "Verify & Co-Sign"
                )}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
