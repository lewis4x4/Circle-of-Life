"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ChevronDown,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  Phone,
  Stethoscope,
} from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { ResidentSelector } from "@/components/medication/ResidentSelector";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const ORDER_TYPES = [
  { value: "new_medication", label: "New medication" },
  { value: "dose_change", label: "Dose change" },
  { value: "frequency_change", label: "Frequency change" },
  { value: "discontinue", label: "Discontinue" },
  { value: "diet_change", label: "Diet change" },
  { value: "activity_restriction", label: "Activity restriction" },
  { value: "lab_order", label: "Lab order" },
  { value: "other", label: "Other" },
] as const;

type OrderType = (typeof ORDER_TYPES)[number]["value"];

function formatDueDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export default function NewVerbalOrderPage() {
  const supabase = useMemo(() => createClient(), []);
  const { selectedFacilityId, availableFacilities } = useFacilityStore();

  // Form state
  const [residentId, setResidentId] = useState("");
  const [orderType, setOrderType] = useState<OrderType>("new_medication");
  const [orderText, setOrderText] = useState("");
  const [indication, setIndication] = useState("");
  const [prescriberName, setPrescriberName] = useState("");
  const [prescriberPhone, setPrescriberPhone] = useState("");
  const [readBack, setReadBack] = useState(false);

  // UI state
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submittedOrder, setSubmittedOrder] = useState<{
    orderNumber?: string;
    dueDate: string;
  } | null>(null);

  // Auth context
  const [userId, setUserId] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);
  const [loadingContext, setLoadingContext] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        setUserId(data.user?.id ?? null);
        if (!data.user) return;

        const p = await supabase
          .from("user_profiles")
          .select("organization_id")
          .eq("id", data.user.id)
          .maybeSingle();
        if (p.data?.organization_id) setOrgId(p.data.organization_id);
      } finally {
        setLoadingContext(false);
      }
    })();
  }, [supabase]);

  const submit = useCallback(async () => {
    setError(null);
    if (!isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Please select a facility in the header first.");
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
      setError("Please confirm that you read back the order with the prescriber.");
      return;
    }

    setSaving(true);
    try {
      const receivedAt = new Date();
      const due = new Date(receivedAt.getTime() + 48 * 60 * 60 * 1000);

      const { data: insData, error: insErr } = await supabase
        .from("verbal_orders")
        .insert({
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
        })
        .select("id")
        .single();

      if (insErr) throw insErr;

      setSubmittedOrder({
        orderNumber: insData?.id?.slice(0, 8).toUpperCase(),
        dueDate: formatDueDate(due),
      });
      setSuccess(true);
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
  ]);

  const handleAnother = () => {
    setSuccess(false);
    setSubmittedOrder(null);
    setResidentId("");
    setOrderType("new_medication");
    setOrderText("");
    setIndication("");
    setPrescriberName("");
    setPrescriberPhone("");
    setReadBack(false);
    setError(null);
  };

  const getFacilityName = (): string => {
    if (!selectedFacilityId) return "Select a facility";
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name || "Unknown facility";
  };

  if (loadingContext) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-indigo-500" />
      </div>
    );
  }

  if (success && submittedOrder) {
    return (
      <div className="max-w-lg mx-auto mt-12">
        <div className="glass-panel rounded-[2.5rem] p-10 md:p-14 text-center border border-emerald-500/30 bg-emerald-50/50 dark:bg-emerald-950/20 shadow-sm backdrop-blur-3xl">
          <div className="w-20 h-20 bg-emerald-500/20 rounded-full flex items-center justify-center mx-auto mb-6 border border-emerald-400/50">
            <CheckCircle2 className="w-10 h-10 text-emerald-500" />
          </div>
          <h2 className="text-3xl font-display font-light tracking-tight text-slate-900 dark:text-white mb-3">
            Verbal Order Captured
          </h2>
          <p className="text-slate-600 dark:text-zinc-400 mb-6 max-w-md leading-relaxed">
            Order has been documented. Please obtain physician co-signature within 48 hours to complete the record.
          </p>

          <div className="bg-white dark:bg-black/40 rounded-2xl p-5 mb-8 border border-emerald-200 dark:border-emerald-500/20">
            <p className="text-xs font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-500 mb-2">
              Co-signature Due
            </p>
            <p className="text-lg font-display text-emerald-700 dark:text-emerald-400">
              {submittedOrder.dueDate}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-3 w-full">
            <Link
              href="/admin/medications/verbal-orders"
              className={cn(
                buttonVariants(),
                "h-14 rounded-2xl font-bold tracking-wide bg-emerald-600 text-white hover:bg-emerald-700"
              )}
            >
              View in Queue
            </Link>
            <button
              type="button"
              onClick={handleAnother}
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-14 rounded-2xl font-bold tracking-wide border-slate-200 dark:border-white/10 text-slate-700 dark:text-slate-300"
              )}
            >
              File Another
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto pb-12 space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end justify-between bg-white/40 dark:bg-black/20 p-6 md:p-8 rounded-[2.5rem] border border-slate-200/50 dark:border-white/5 backdrop-blur-3xl shadow-sm">
        <div className="space-y-2">
          <Link
            href="/admin/medications/verbal-orders"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "mb-2 gap-1 px-0 text-slate-500 hover:bg-transparent hover:text-slate-900 dark:hover:text-white"
            )}
          >
            ← Back to verbal orders
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-rose-100 dark:bg-rose-500/10 border border-rose-200 dark:border-rose-500/20 text-[10px] font-bold uppercase tracking-widest text-rose-800 dark:text-rose-300 mb-2">
            <Phone className="w-3 h-3" /> Verbal Order
          </div>
          <h1 className="text-3xl md:text-4xl font-display font-light tracking-tight text-slate-900 dark:text-white">
            New Verbal Order
          </h1>
          <p className="text-sm font-medium tracking-wide text-slate-600 dark:text-slate-400 mt-1">
            Capture a phone/verbal order. Co-signature is due within 48 hours.
          </p>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="rounded-2xl border border-rose-200 dark:border-rose-800/60 bg-rose-50 dark:bg-rose-950/30 px-6 py-4 flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-rose-600 dark:text-rose-400 mt-0.5 flex-shrink-0" />
          <p className="text-sm font-medium text-rose-700 dark:text-rose-200">{error}</p>
        </div>
      )}

      {/* Context Section */}
      <div className="glass-panel rounded-[2.5rem] border border-indigo-500/10 bg-white/60 dark:bg-white/[0.02] p-6 md:p-8 shadow-sm backdrop-blur-3xl">
        <h3 className="text-sm font-bold uppercase tracking-widest text-indigo-500 mb-6 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-indigo-500"></span>
          Context
        </h3>

        <div className="space-y-5">
          {/* Facility (read-only) */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">
              Facility
            </label>
            <div className="h-14 rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-black/40 px-5 flex items-center text-sm font-medium text-slate-700 dark:text-slate-300">
              {getFacilityName()}
            </div>
          </div>

          {/* Resident Selector */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">
              Resident <span className="text-rose-500">*</span>
            </label>
            <ResidentSelector
              value={residentId}
              onChange={(id) => {
                setResidentId(id);
              }}
              placeholder="Select a resident"
            />
          </div>

          {/* Order Type */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">
              Order Type <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <select
                id="order_type"
                value={orderType}
                onChange={(e) => setOrderType(e.target.value as OrderType)}
                className="w-full h-14 appearance-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 px-5 text-[15px] font-medium text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              >
                {ORDER_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <ChevronDown className="absolute right-5 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
            </div>
          </div>
        </div>
      </div>

      {/* Order Details Section */}
      <div className="glass-panel rounded-[2.5rem] border border-violet-500/10 bg-white/60 dark:bg-white/[0.02] p-6 md:p-8 shadow-sm backdrop-blur-3xl">
        <h3 className="text-sm font-bold uppercase tracking-widest text-violet-500 mb-6 flex items-center gap-2">
          <Stethoscope className="w-4 h-4" />
          Order Details
        </h3>

        <div className="space-y-5">
          {/* Verbatim Order */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">
              Verbatim Order <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="order_text"
              value={orderText}
              onChange={(e) => setOrderText(e.target.value)}
              rows={5}
              placeholder="Enter the exact order as received from the prescriber..."
              className="w-full resize-none rounded-[1.2rem] border border-slate-200 dark:border-white/10 bg-white dark:bg-black/40 p-5 text-[15px] leading-relaxed text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-violet-500/50 placeholder:text-slate-400 dark:placeholder:text-zinc-600"
            />
            <p className="text-xs text-slate-500 dark:text-zinc-500">
              This must match exactly what the physician said.
            </p>
          </div>

          {/* Indication (optional) */}
          <div className="space-y-2">
            <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">
              Indication <span className="font-normal opacity-60">(optional)</span>
            </label>
            <Input
              id="indication"
              value={indication}
              onChange={(e) => setIndication(e.target.value)}
              placeholder="Clinical reason for this order"
              className="h-14 rounded-[1.2rem]"
            />
          </div>

          {/* Prescriber Info Grid */}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">
                Prescriber Name <span className="text-rose-500">*</span>
              </label>
              <Input
                id="prescriber_name"
                value={prescriberName}
                onChange={(e) => setPrescriberName(e.target.value)}
                placeholder="Dr. Lastname"
                className="h-14 rounded-[1.2rem]"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[11px] font-bold uppercase tracking-widest text-slate-500 dark:text-zinc-400 pl-1">
                Prescriber Phone <span className="font-normal opacity-60">(optional)</span>
              </label>
              <Input
                id="prescriber_phone"
                value={prescriberPhone}
                onChange={(e) => setPrescriberPhone(e.target.value)}
                placeholder="(555) 000-0000"
                className="h-14 rounded-[1.2rem]"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Confirmation Section */}
      <div className="glass-panel rounded-[2.5rem] border border-rose-500/10 bg-white/60 dark:bg-white/[0.02] p-6 md:p-8 shadow-sm backdrop-blur-3xl">
        <h3 className="text-sm font-bold uppercase tracking-widest text-rose-500 mb-6 flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-rose-500"></span>
          Confirmation
        </h3>

        <div className="space-y-4">
          {/* Read-back confirmation */}
          <label className={cn(
            "flex items-start gap-4 cursor-pointer w-fit border border-slate-200 dark:border-white/5",
            "bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/[0.05]",
            "transition-colors pr-6 pl-4 py-4 rounded-2xl",
            readBack ? "border-rose-300 dark:border-rose-500/30" : ""
          )}>
            <div className="relative w-6 h-6 rounded-md border-2 border-slate-300 dark:border-zinc-500 bg-white dark:bg-black/40 flex items-center justify-center shrink-0 mt-0.5">
              <input
                type="checkbox"
                checked={readBack}
                onChange={(e) => setReadBack(e.target.checked)}
                className="absolute inset-0 opacity-0 cursor-pointer peer"
              />
              <CheckCircle2 className="w-5 h-5 text-rose-500 opacity-0 peer-checked:opacity-100 transition-opacity" />
            </div>
            <div>
              <span className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-zinc-300 block">
                Read-back Confirmed
              </span>
              <span className="text-xs text-slate-500 dark:text-zinc-500 block mt-1">
                I read the order back to the prescriber and confirmed accuracy
              </span>
            </div>
          </label>

          {/* Submit Button */}
          <button
            type="button"
            disabled={saving || !readBack || !residentId || !orderText || !prescriberName}
            onClick={() => void submit()}
            className="w-full h-16 rounded-[1.5rem] flex items-center justify-center font-bold tracking-widest uppercase transition-all shadow-lg bg-gradient-to-r from-violet-600 to-violet-500 text-white hover:from-violet-500 hover:to-violet-400 disabled:opacity-50 disabled:grayscale disabled:cursor-not-allowed text-lg"
          >
            {saving ? (
              <>
                <Loader2 className="mr-3 h-6 w-6 animate-spin" />
                Saving...
              </>
            ) : (
              "Submit Verbal Order"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
