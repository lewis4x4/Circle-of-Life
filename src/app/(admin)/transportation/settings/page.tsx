"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { formatInTimeZone } from "date-fns-tz";
import { ArrowLeft, Gauge, Info, MessageSquare } from "lucide-react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { FACILITY_OPERATOR_TZ } from "@/lib/facility-wall-clock";
import { createClient } from "@/lib/supabase/client";
import { canMutateFinance } from "@/lib/finance/load-finance-context";
import { DEFAULT_MILEAGE_RATE_CENTS } from "@/lib/transport/mileage-defaults";
import { formatCentsPerMileUsd } from "@/lib/transport/org-mileage-rate";
import {
  TRANSPORT_SETTINGS_LOADING_PROFILE_COPY,
  TRANSPORT_SETTINGS_LOADING_SETTINGS_COPY,
  TRANSPORT_SETTINGS_ORG_WIDE_SCOPE_CUE,
} from "@/lib/transport/transport-settings-display-copy";
import {
  resolveTransportSettingsFetchErrorBannerMessage,
  resolveTransportSettingsOrganizationGapMessage,
} from "@/lib/transport/transport-settings-page-state";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

const PREVIEW_MILES = [25, 100, 250];

const formSchema = z.object({
  /** Dollars per mile, e.g. 0.7 for 70¢ */
  dollarsPerMile: z
    .string()
    .min(1, "Enter a rate")
    .refine((s) => {
      const n = Number.parseFloat(s.replace(/,/g, ""));
      return !Number.isNaN(n) && n >= 0.01 && n <= 10;
    }, "Use between $0.01 and $10.00 per mile"),
});

type FormValues = z.infer<typeof formSchema>;

function dollarsToCents(s: string): number {
  const n = Number.parseFloat(s.replace(/,/g, ""));
  return Math.round(n * 100);
}

function centsToDollarsInput(cents: number): string {
  return (cents / 100).toFixed(2);
}

export default function TransportationOrgSettingsPage() {
  const supabase = createClient();
  const { user, organizationId, appRole, loading: authLoading } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const canWrite = canMutateFinance(role);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [savedOk, setSavedOk] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [hasRow, setHasRow] = useState(false);

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: { dollarsPerMile: centsToDollarsInput(DEFAULT_MILEAGE_RATE_CENTS) },
  });

  const load = useCallback(async () => {
    if (authLoading) {
      setLoading(false);
      return;
    }
    if (!organizationId) {
      setHasRow(false);
      setUpdatedAt(null);
      setLoading(false);
      setFetchError(null);
      return;
    }
    setLoading(true);
    setFetchError(null);
    setSavedOk(false);
    try {
      const { data, error: qErr } = await supabase
        .from("organization_transport_settings")
        .select("mileage_reimbursement_rate_cents, updated_at")
        .eq("organization_id", organizationId)
        .maybeSingle();

      if (qErr) {
        setFetchError(qErr.message);
        return;
      }

      if (data) {
        setHasRow(true);
        setUpdatedAt(data.updated_at);
        form.reset({ dollarsPerMile: centsToDollarsInput(data.mileage_reimbursement_rate_cents) });
      } else {
        setHasRow(false);
        setUpdatedAt(null);
        form.reset({ dollarsPerMile: centsToDollarsInput(DEFAULT_MILEAGE_RATE_CENTS) });
      }
    } catch (e) {
      setFetchError(e instanceof Error ? e.message : "Unable to load settings.");
    } finally {
      setLoading(false);
    }
  }, [authLoading, organizationId, supabase, form]);

  useEffect(() => {
    void load();
  }, [load]);

  const watchedDollars = form.watch("dollarsPerMile");
  const previewCents = useMemo(() => {
    const n = Number.parseFloat((watchedDollars ?? "").replace(/,/g, ""));
    if (Number.isNaN(n) || n < 0.01) return DEFAULT_MILEAGE_RATE_CENTS;
    return Math.round(n * 100);
  }, [watchedDollars]);

  const organizationGapMessage = resolveTransportSettingsOrganizationGapMessage({
    authLoading,
    organizationId,
    hasOrgScopedData: hasRow,
  });
  const fetchErrorBannerMessage = resolveTransportSettingsFetchErrorBannerMessage({
    authLoading,
    fetchError,
  });
  const showLoading = authLoading || loading;

  async function onSubmit(values: FormValues) {
    setFetchError(null);
    setSavedOk(false);
    if (authLoading) return;
    if (!canWrite) {
      setFetchError("You do not have permission to change organization reimbursement settings.");
      return;
    }
    if (!organizationId) return;
    if (!user) {
      setFetchError("Sign in required.");
      return;
    }

    const cents = dollarsToCents(values.dollarsPerMile);

    if (hasRow) {
      const { error: upErr } = await supabase
        .from("organization_transport_settings")
        .update({
          mileage_reimbursement_rate_cents: cents,
          updated_by: user.id,
        })
        .eq("organization_id", organizationId);
      if (upErr) {
        setFetchError(upErr.message);
        return;
      }
    } else {
      const { error: insErr } = await supabase.from("organization_transport_settings").insert({
        organization_id: organizationId,
        mileage_reimbursement_rate_cents: cents,
        created_by: user.id,
        updated_by: user.id,
      });
      if (insErr) {
        setFetchError(insErr.message);
        return;
      }
    }

    setSavedOk(true);
    setHasRow(true);
    await load();
  }

  return (
    <div className="mx-auto max-w-5xl space-y-10 pb-16 w-full px-4 sm:px-6">
      <div className="flex flex-col gap-6 md:flex-row md:items-end justify-between dark: dark: dark: p-8 md:p-10 rounded-lg border border-slate-200/60 dark:border-white/10 shadow-sm mt-4">
        <div className="space-y-3">
          <Link
            href="/admin/transportation"
            className={cn(
              buttonVariants({ variant: "ghost", size: "sm" }),
              "-ml-2 mb-1 gap-2 text-slate-600 dark:text-zinc-400 hover:text-slate-900 dark:hover:text-white",
            )}
          >
            <ArrowLeft className="h-4 w-4" />
            Fleet operations
          </Link>
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-100/80 dark:bg-primary-500/15 border border-primary-200/60 dark:border-primary-500/20 text-[10px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">
            <Gauge className="h-3.5 w-3.5" />
            Operations · Reimbursement
          </div>
          <h1 className="text-3xl md:text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Mileage reimbursement rate
          </h1>
          <p className="max-w-2xl text-base font-medium leading-relaxed text-slate-600 dark:text-zinc-400">
            Set how staff are reimbursed per mile when using a <strong className="text-slate-800 dark:text-zinc-200">personal vehicle</strong> for approved resident transport. This rate is stored on each new{" "}
            <span className="font-mono text-sm">mileage_logs</span> row at the time it is created — changing it does not rewrite history.
          </p>
          <p className="max-w-2xl text-sm text-muted-foreground">{TRANSPORT_SETTINGS_ORG_WIDE_SCOPE_CUE}</p>
        </div>
        <div className="hidden md:flex h-24 w-24 shrink-0 items-center justify-center rounded-lg border border-primary-200/50 bg-primary-500/10 dark:border-primary-500/20 dark:bg-primary-500/5">
          <MessageSquare className="h-10 w-10 text-primary-500 dark:text-primary-400" aria-hidden />
        </div>
      </div>

      {authLoading ? (
        <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
          {TRANSPORT_SETTINGS_LOADING_PROFILE_COPY}
        </p>
      ) : null}

      {organizationGapMessage ? (
        <Card className="rounded-lg border border-dashed border-muted-foreground/35 bg-muted/30 shadow-sm">
          <CardContent className="p-4 text-sm text-muted-foreground">{organizationGapMessage}</CardContent>
        </Card>
      ) : null}

      {fetchErrorBannerMessage ? (
        <div
          role="alert"
          className="rounded-2xl border border-rose-200 bg-rose-50/90 px-5 py-4 text-sm text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-100"
        >
          {fetchErrorBannerMessage}
        </div>
      ) : null}

      {savedOk && (
        <div
          role="status"
          className="rounded-2xl border border-emerald-200 bg-emerald-50/90 px-5 py-4 text-sm font-medium text-emerald-900 dark:border-emerald-900/40 dark:bg-emerald-950/30 dark:text-emerald-100"
        >
          Settings saved. New mileage logs will use {formatCentsPerMileUsd(previewCents)} per mile.
        </div>
      )}

      <div className="grid gap-8 lg:grid-cols-5 lg:gap-10">
        <div className="lg:col-span-3 space-y-6">
          <div className="rounded-lg border border-slate-200/70 bg-white/70 p-6 shadow-sm  dark:border-white/10 dark:bg-white/[0.04] md:p-8">
            {authLoading ? null : showLoading ? (
              <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
                {TRANSPORT_SETTINGS_LOADING_SETTINGS_COPY}
              </p>
            ) : organizationGapMessage ? null : (
              <form className="space-y-6" onSubmit={form.handleSubmit(onSubmit)}>
                <div className="space-y-2">
                  <Label htmlFor="dollarsPerMile" className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-zinc-500">
                    Rate (USD per mile)
                  </Label>
                  <div className="relative">
                    <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-slate-400 dark:text-zinc-500">
                      $
                    </span>
                    <Input
                      id="dollarsPerMile"
                      inputMode="decimal"
                      autoComplete="off"
                      disabled={!canWrite}
                      className={cn(
                        "h-14 rounded-2xl border-slate-200 pl-9 text-2xl font-semibold tracking-tight tabular-nums dark:border-white/10",
                        form.formState.errors.dollarsPerMile && "border-rose-500 focus-visible:ring-rose-500/30",
                      )}
                      {...form.register("dollarsPerMile")}
                    />
                  </div>
                  {form.formState.errors.dollarsPerMile && (
                    <p className="text-sm text-rose-600 dark:text-rose-400">{form.formState.errors.dollarsPerMile.message}</p>
                  )}
                  <p className="flex items-start gap-2 text-xs leading-relaxed text-slate-500 dark:text-zinc-500">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary-500" aria-hidden />
                    Many operators align with the IRS optional standard mileage rate for business use; confirm with your CPA. Haven does not provide tax advice.
                  </p>
                </div>

                {canWrite ? (
                  <Button
                    type="submit"
                    disabled={form.formState.isSubmitting}
                    className="h-12 rounded-full px-8 text-sm font-semibold bg-primary-600 hover:bg-primary-700"
                  >
                    {form.formState.isSubmitting ? "Saving…" : "Save organization rate"}
                  </Button>
                ) : (
                  <p className="text-sm font-medium text-amber-800 dark:text-amber-200/90">
                    Read-only: only <strong>Owner</strong> and <strong>Org admin</strong> can edit this rate.
                  </p>
                )}

                {updatedAt && (
                  <p className="text-xs text-slate-500 dark:text-zinc-500">
                    Record last touched{" "}
                    {formatInTimeZone(new Date(updatedAt), FACILITY_OPERATOR_TZ, "MMM d, yyyy · h:mm a")} ET
                  </p>
                )}
              </form>
            )}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          <div className="rounded-lg border border-primary-200/40 p-6 shadow-inner dark:border-primary-500/15 dark: dark: dark:shadow-none">
            <h2 className="text-[11px] font-bold uppercase tracking-wider text-primary-700 dark:text-primary-300">Live preview</h2>
            <p className="mt-2 text-sm text-slate-600 dark:text-zinc-400">
              Estimated reimbursement at <span className="font-semibold text-slate-900 dark:text-white">{formatCentsPerMileUsd(previewCents)}</span> / mi
              {!hasRow && !showLoading && !organizationGapMessage && (
                <span className="block pt-1 text-xs font-normal opacity-80">
                  (default {formatCentsPerMileUsd(DEFAULT_MILEAGE_RATE_CENTS)} until you save)
                </span>
              )}
            </p>
            <ul className="mt-6 space-y-3 border-t border-primary-200/30 pt-4 dark:border-white/10">
              {PREVIEW_MILES.map((m) => (
                <li
                  key={m}
                  className="flex items-center justify-between rounded-xl bg-card px-4 py-3 text-sm dark:bg-white/5"
                >
                  <span className="tabular-nums text-slate-600 dark:text-zinc-400">{m} mi</span>
                  <span className="text-lg font-medium tabular-nums text-primary-700 dark:text-primary-300">
                    {formatCentsPerMileUsd(previewCents * m)}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-2xl border border-slate-200/60 bg-slate-50/50 p-5 text-xs leading-relaxed text-slate-600 dark:border-white/10 dark:text-zinc-500">
            <strong className="font-semibold text-slate-800 dark:text-zinc-300">Effective scope:</strong> applies when completing a transport request with a linked mileage log for{" "}
            <span className="font-mono">staff_personal_vehicle</span>. Existing mileage rows keep their original rate.
          </div>
        </div>
      </div>
    </div>
  );
}
