"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const ORDER_TYPES = [
  "new_medication",
  "dose_change",
  "frequency_change",
  "discontinue",
  "diet_change",
  "activity_restriction",
  "lab_order",
  "other",
] as const;

export default function NewVerbalOrderPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId } = useFacilityStore();
  const [residentId, setResidentId] = useState("");
  const [orderType, setOrderType] = useState<string>("new_medication");
  const [orderText, setOrderText] = useState("");
  const [indication, setIndication] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [prescriberPhone, setPrescriberPhone] = useState("");
  const [readBack, setReadBack] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.auth.getUser();
      setUserId(data.user?.id ?? null);
      if (!data.user) return;
      const p = await supabase
        .from("user_profiles")
        .select("organization_id")
        .eq("id", data.user.id)
        .maybeSingle();
      if (p.data?.organization_id) setOrgId(p.data.organization_id);
    })();
  }, [supabase]);

  const submit = useCallback(async () => {
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    if (!userId || !orgId) {
      setError("Could not resolve your profile or organization.");
      return;
    }
    if (!residentId.trim() || !orderText.trim() || !prescriberName.trim()) {
      setError("Resident, order text, and prescriber name are required.");
      return;
    }
    if (!readBack) {
      setError("Confirm read-back before saving.");
      return;
    }
    setSaving(true);
    try {
      const receivedAt = new Date();
      const due = new Date(receivedAt.getTime() + 48 * 60 * 60 * 1000);
      const { error: insErr } = await supabase.from("verbal_orders").insert({
        resident_id: residentId.trim(),
        facility_id: selectedFacilityId,
        organization_id: orgId,
        order_type: orderType,
        order_text: orderText.trim(),
        indication: indication.trim() || null,
        prescriber_name: prescriberName.trim(),
        prescriber_phone: prescriberPhone.trim() || null,
        received_by: userId,
        received_at: receivedAt.toISOString(),
        read_back_confirmed: true,
        cosignature_due_at: due.toISOString(),
        created_by: userId,
      });
      if (insErr) throw insErr;
      router.push("/admin/medications/verbal-orders");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }, [
    supabase,
    selectedFacilityId,
    userId,
    orgId,
    residentId,
    orderType,
    orderText,
    indication,
    prescriberName,
    prescriberPhone,
    readBack,
    router,
  ]);

  return (
    <div className="mx-auto max-w-lg space-y-6">
      <Link
        href="/admin/medications/verbal-orders"
        className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "gap-1 px-0")}
      >
        <ArrowLeft className="h-4 w-4" />
        Verbal orders
      </Link>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">New verbal order</CardTitle>
          <CardDescription>Capture a phone/verbal order. Co-signature is due within 48 hours.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}

          <div className="space-y-2">
            <Label htmlFor="resident_id">Resident ID (UUID)</Label>
            <Input
              id="resident_id"
              value={residentId}
              onChange={(e) => setResidentId(e.target.value)}
              placeholder="From resident profile URL"
              className="font-mono text-sm"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="order_type">Order type</Label>
            <select
              id="order_type"
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              className="flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 text-sm dark:border-slate-800 dark:bg-slate-950"
            >
              {ORDER_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="order_text">Verbatim order</Label>
            <textarea
              id="order_text"
              value={orderText}
              onChange={(e) => setOrderText(e.target.value)}
              rows={4}
              className="flex min-h-[96px] w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="indication">Indication (optional)</Label>
            <Input id="indication" value={indication} onChange={(e) => setIndication(e.target.value)} />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="prescriber_name">Prescriber name</Label>
              <Input
                id="prescriber_name"
                value={prescriberName}
                onChange={(e) => setPrescriberName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="prescriber_phone">Prescriber phone (optional)</Label>
              <Input
                id="prescriber_phone"
                value={prescriberPhone}
                onChange={(e) => setPrescriberPhone(e.target.value)}
              />
            </div>
          </div>

          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={readBack} onChange={(e) => setReadBack(e.target.checked)} />
            Read-back confirmed with prescriber
          </label>

          <button
            type="button"
            disabled={saving}
            onClick={() => void submit()}
            className={cn(buttonVariants(), "w-full")}
          >
            {saving ? "Saving…" : "Save verbal order"}
          </button>
        </CardContent>
      </Card>
    </div>
  );
}
