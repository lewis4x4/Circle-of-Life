"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Banknote, Loader2, Plus, Wallet } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { formatCents, parseDollarsToCents } from "@/lib/finance/format-cents";
import { fetchActorContext } from "@/lib/office/meetings";
import {
  PETTY_CASH_CATEGORIES,
  TRUST_CATEGORIES,
  categoryLabel,
  pettyCashDelta,
  trustDelta,
  type PettyCashAccountRow,
  type PettyCashDirection,
  type PettyCashTxRow,
  type QueryError,
  type QueryResult,
  type ResidentMini,
  type TrustAccountRow,
  type TrustDirection,
  type TrustTxRow,
} from "@/lib/office/ledgers";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
});

type Tab = "petty" | "trust";

export default function AdminCashLedgersPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [tab, setTab] = useState<Tab>("petty");
  const [residents, setResidents] = useState<ResidentMini[]>([]);
  const [pettyAccount, setPettyAccount] = useState<PettyCashAccountRow | null>(null);
  const [pettyTx, setPettyTx] = useState<PettyCashTxRow[]>([]);
  const [trustAccounts, setTrustAccounts] = useState<TrustAccountRow[]>([]);
  const [trustTx, setTrustTx] = useState<TrustTxRow[]>([]);
  const [selectedTrustId, setSelectedTrustId] = useState<string>("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Petty cash post form
  const [pDir, setPDir] = useState<PettyCashDirection>("debit");
  const [pAmount, setPAmount] = useState("");
  const [pCategory, setPCategory] = useState("resident_expense");
  const [pDesc, setPDesc] = useState("");
  const [pResident, setPResident] = useState("");

  // Trust post form
  const [tDir, setTDir] = useState<TrustDirection>("deposit");
  const [tAmount, setTAmount] = useState("");
  const [tCategory, setTCategory] = useState("benefit_deposit");
  const [tDesc, setTDesc] = useState("");

  // New trust account
  const [newTrustResident, setNewTrustResident] = useState("");
  const [newRepPayee, setNewRepPayee] = useState(false);
  const [newSsa787, setNewSsa787] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setResidents([]);
      setPettyAccount(null);
      setPettyTx([]);
      setTrustAccounts([]);
      setTrustTx([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const fid = selectedFacilityId as string;
      const residentsQ = supabase
        .from("residents")
        .select("id, first_name, last_name")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("last_name");
      const pettyAccountQ = supabase
        .from("petty_cash_accounts" as never)
        .select("id, name, balance_cents, is_active")
        .eq("facility_id", fid)
        .is("deleted_at", null)
        .order("created_at")
        .limit(1);
      const trustAccountsQ = supabase
        .from("resident_trust_accounts" as never)
        .select("id, resident_id, balance_cents, is_rep_payee, ssa_787_on_file, is_active")
        .eq("facility_id", fid)
        .is("deleted_at", null);

      const [rRes, paRes, taRes] = await Promise.all([
        residentsQ as unknown as Promise<QueryResult<ResidentMini>>,
        pettyAccountQ as unknown as Promise<QueryResult<PettyCashAccountRow>>,
        trustAccountsQ as unknown as Promise<QueryResult<TrustAccountRow>>,
      ]);
      const err: QueryError | null = rRes.error ?? paRes.error ?? taRes.error;
      if (err) throw new Error(err.message);
      setResidents(rRes.data ?? []);
      const account = (paRes.data ?? [])[0] ?? null;
      setPettyAccount(account);
      setTrustAccounts(taRes.data ?? []);

      if (account) {
        const ptxRes = (await supabase
          .from("petty_cash_transactions" as never)
          .select(
            "id, direction, amount_cents, balance_after_cents, category, description, resident_id, occurred_at",
          )
          .eq("account_id", account.id)
          .is("deleted_at", null)
          .order("occurred_at", { ascending: false })
          .limit(100)) as unknown as QueryResult<PettyCashTxRow>;
        if (ptxRes.error) throw new Error(ptxRes.error.message);
        setPettyTx(ptxRes.data ?? []);
      } else {
        setPettyTx([]);
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load ledgers.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const loadTrustTx = useCallback(
    async (accountId: string) => {
      const res = (await supabase
        .from("resident_trust_transactions" as never)
        .select(
          "id, account_id, resident_id, direction, amount_cents, balance_after_cents, category, description, occurred_at",
        )
        .eq("account_id", accountId)
        .is("deleted_at", null)
        .order("occurred_at", { ascending: false })
        .limit(100)) as unknown as QueryResult<TrustTxRow>;
      if (res.error) {
        setNotice(res.error.message);
        return;
      }
      setTrustTx(res.data ?? []);
    },
    [supabase],
  );

  useEffect(() => {
    if (selectedTrustId) void loadTrustTx(selectedTrustId);
    else setTrustTx([]);
  }, [selectedTrustId, loadTrustTx]);

  const residentName = useCallback(
    (id: string | null) => {
      if (!id) return null;
      const r = residents.find((x) => x.id === id);
      return r ? `${r.first_name} ${r.last_name}`.trim() : null;
    },
    [residents],
  );

  const createPettyAccount = useCallback(async () => {
    if (!facilityReady) return;
    setBusy(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("petty_cash_accounts" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to open the petty cash drawer.");
    } finally {
      setBusy(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, load]);

  const postPetty = useCallback(async () => {
    if (!pettyAccount) return;
    const cents = parseDollarsToCents(pAmount);
    if (!cents || cents <= 0 || !pDesc.trim()) {
      setNotice("Enter a positive amount and a description.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const newBalance = pettyAccount.balance_cents + pettyCashDelta(pDir, cents);
      const { error: txErr } = await supabase.from("petty_cash_transactions" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        account_id: pettyAccount.id,
        direction: pDir,
        amount_cents: cents,
        balance_after_cents: newBalance,
        category: pCategory,
        description: pDesc.trim(),
        resident_id: pResident || null,
        created_by: actor.userId,
      } as never);
      if (txErr) throw new Error(txErr.message);
      const { error: accErr } = await supabase
        .from("petty_cash_accounts" as never)
        .update({ balance_cents: newBalance, updated_by: actor.userId } as never)
        .eq("id", pettyAccount.id);
      if (accErr) throw new Error(accErr.message);
      setPAmount("");
      setPDesc("");
      setPResident("");
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to post the transaction.");
    } finally {
      setBusy(false);
    }
  }, [supabase, pettyAccount, pAmount, pDir, pCategory, pDesc, pResident, selectedFacilityId, load]);

  const openTrustAccount = useCallback(async () => {
    if (!facilityReady || !newTrustResident) return;
    setBusy(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("resident_trust_accounts" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        resident_id: newTrustResident,
        is_rep_payee: newRepPayee,
        ssa_787_on_file: newSsa787,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setNewTrustResident("");
      setNewRepPayee(false);
      setNewSsa787(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to open trust account.");
    } finally {
      setBusy(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, newTrustResident, newRepPayee, newSsa787, load]);

  const selectedTrust = useMemo(
    () => trustAccounts.find((a) => a.id === selectedTrustId) ?? null,
    [trustAccounts, selectedTrustId],
  );

  const postTrust = useCallback(async () => {
    if (!selectedTrust) return;
    const cents = parseDollarsToCents(tAmount);
    if (!cents || cents <= 0 || !tDesc.trim()) {
      setNotice("Enter a positive amount and a description.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const newBalance = selectedTrust.balance_cents + trustDelta(tDir, cents);
      if (newBalance < 0) {
        setNotice("Withdrawal exceeds the trust balance.");
        setBusy(false);
        return;
      }
      const { error: txErr } = await supabase.from("resident_trust_transactions" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        account_id: selectedTrust.id,
        resident_id: selectedTrust.resident_id,
        direction: tDir,
        amount_cents: cents,
        balance_after_cents: newBalance,
        category: tCategory,
        description: tDesc.trim(),
        created_by: actor.userId,
      } as never);
      if (txErr) throw new Error(txErr.message);
      const { error: accErr } = await supabase
        .from("resident_trust_accounts" as never)
        .update({ balance_cents: newBalance, updated_by: actor.userId } as never)
        .eq("id", selectedTrust.id);
      if (accErr) throw new Error(accErr.message);
      setTAmount("");
      setTDesc("");
      await load();
      await loadTrustTx(selectedTrust.id);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to post the transaction.");
    } finally {
      setBusy(false);
    }
  }, [supabase, selectedTrust, tAmount, tDir, tCategory, tDesc, selectedFacilityId, load, loadTrustTx]);

  const residentsWithoutTrust = useMemo(() => {
    const taken = new Set(trustAccounts.map((a) => a.resident_id));
    return residents.filter((r) => !taken.has(r.id));
  }, [residents, trustAccounts]);

  const inputCls =
    "rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground";

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-2">
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <Wallet className="h-8 w-8 text-info shrink-0" aria-hidden />
            Cash &amp; resident trust
          </h2>
          <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
            Petty cash drawer and per-resident trust accounts (Representative Payee / SSA-787).
            All amounts are stored in cents; posted ledger entries are immutable.
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — ledgers are per-facility.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady ? (
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Ledgers">
            <button type="button" role="tab" aria-selected={tab === "petty"} onClick={() => setTab("petty")}
              className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                tab === "petty" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground border border-border hover:bg-muted")}>
              <Banknote className="h-4 w-4" aria-hidden /> Petty cash
            </button>
            <button type="button" role="tab" aria-selected={tab === "trust"} onClick={() => setTab("trust")}
              className={cn("inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors",
                tab === "trust" ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground border border-border hover:bg-muted")}>
              <Wallet className="h-4 w-4" aria-hidden /> Resident trust
            </button>
          </div>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError && tab === "petty" ? (
          <section className="space-y-3">
            {!pettyAccount ? (
              <div className="rounded-[var(--radius)] border border-border bg-card p-6 text-center space-y-3">
                <p className="text-sm text-muted-foreground">
                  No petty cash drawer for this facility yet.
                </p>
                <Button type="button" disabled={busy} onClick={() => void createPettyAccount()} className="gap-2">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                  Open petty cash drawer
                </Button>
              </div>
            ) : (
              <>
                <div className="rounded-[var(--radius)] border border-border bg-card/60 px-5 py-4 flex items-center justify-between">
                  <span className="text-sm font-medium text-muted-foreground">{pettyAccount.name}</span>
                  <span className="text-2xl font-semibold tabular-nums text-foreground">
                    {formatCents(pettyAccount.balance_cents)}
                  </span>
                </div>

                <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4 lg:grid-cols-3">
                  <select value={pDir} onChange={(e) => setPDir(e.target.value as PettyCashDirection)} aria-label="Direction" className={inputCls}>
                    <option value="debit">Disbursement (out)</option>
                    <option value="credit">Replenishment (in)</option>
                  </select>
                  <input type="text" inputMode="decimal" value={pAmount} onChange={(e) => setPAmount(e.target.value)} placeholder="Amount (e.g. 12.50)" aria-label="Amount" className={inputCls} />
                  <select value={pCategory} onChange={(e) => setPCategory(e.target.value)} aria-label="Category" className={inputCls}>
                    {PETTY_CASH_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <input type="text" value={pDesc} onChange={(e) => setPDesc(e.target.value)} placeholder="Description" aria-label="Description" className={cn(inputCls, "lg:col-span-2")} />
                  <select value={pResident} onChange={(e) => setPResident(e.target.value)} aria-label="Resident (optional)" className={inputCls}>
                    <option value="">Resident (optional)…</option>
                    {residents.map((r) => <option key={r.id} value={r.id}>{r.last_name}, {r.first_name}</option>)}
                  </select>
                  <Button type="button" disabled={busy} onClick={() => void postPetty()} className="gap-2 lg:col-span-3">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    Post transaction
                  </Button>
                </div>

                {pettyTx.length === 0 ? (
                  <p className="text-sm text-muted-foreground pl-2">No transactions yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {pettyTx.map((t) => (
                      <li key={t.id} className="flex items-center justify-between gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card">
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-medium text-foreground truncate">{t.description}</span>
                          <span className="text-xs text-muted-foreground">
                            {ET_FMT.format(new Date(t.occurred_at))} · {categoryLabel(PETTY_CASH_CATEGORIES, t.category)}
                            {residentName(t.resident_id) ? ` · ${residentName(t.resident_id)}` : ""}
                          </span>
                        </div>
                        <div className="text-right shrink-0">
                          <span className={cn("font-semibold tabular-nums", t.direction === "credit" ? "text-success" : "text-foreground")}>
                            {t.direction === "credit" ? "+" : "−"}{formatCents(t.amount_cents)}
                          </span>
                          <p className="text-xs text-muted-foreground tabular-nums">bal {formatCents(t.balance_after_cents)}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </section>
        ) : null}

        {facilityReady && !isLoading && !loadError && tab === "trust" ? (
          <section className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
            <div className="space-y-3">
              <div className="rounded-[var(--radius)] border border-border bg-card p-4 space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Open trust account</p>
                <select value={newTrustResident} onChange={(e) => setNewTrustResident(e.target.value)} aria-label="Resident" className={cn(inputCls, "w-full")}>
                  <option value="">Resident…</option>
                  {residentsWithoutTrust.map((r) => <option key={r.id} value={r.id}>{r.last_name}, {r.first_name}</option>)}
                </select>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={newRepPayee} onChange={(e) => setNewRepPayee(e.target.checked)} /> Facility is Rep Payee
                </label>
                <label className="flex items-center gap-2 text-sm text-foreground">
                  <input type="checkbox" checked={newSsa787} onChange={(e) => setNewSsa787(e.target.checked)} /> SSA-787 on file
                </label>
                <Button type="button" disabled={busy || !newTrustResident} onClick={() => void openTrustAccount()} className="gap-2 w-full">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
                  Open account
                </Button>
              </div>

              <ul className="space-y-2">
                {trustAccounts.length === 0 ? (
                  <li className="text-sm text-muted-foreground pl-2">No trust accounts yet.</li>
                ) : (
                  trustAccounts.map((a) => (
                    <li key={a.id}>
                      <button type="button" onClick={() => setSelectedTrustId(a.id)}
                        className={cn("w-full text-left px-[13px] py-2 rounded-[9px] border bg-card transition-colors",
                          selectedTrustId === a.id ? "border-primary bg-primary/10" : "border-border hover:bg-muted/50")}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-foreground truncate">{residentName(a.resident_id) ?? "Resident"}</span>
                          <span className="font-semibold tabular-nums text-foreground">{formatCents(a.balance_cents)}</span>
                        </div>
                        <div className="flex gap-1 mt-1">
                          {a.is_rep_payee ? <StatusPill tone="info">Rep Payee</StatusPill> : null}
                          {a.ssa_787_on_file ? <StatusPill tone="muted">SSA-787</StatusPill> : null}
                        </div>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <div className="space-y-3">
              {!selectedTrust ? (
                <p className="text-sm text-muted-foreground pl-2">Select a trust account to post and view its ledger.</p>
              ) : (
                <>
                  <div className="rounded-[var(--radius)] border border-border bg-card/60 px-5 py-4 flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">{residentName(selectedTrust.resident_id)}</span>
                    <span className="text-2xl font-semibold tabular-nums text-foreground">{formatCents(selectedTrust.balance_cents)}</span>
                  </div>
                  <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4 lg:grid-cols-3">
                    <select value={tDir} onChange={(e) => setTDir(e.target.value as TrustDirection)} aria-label="Direction" className={inputCls}>
                      <option value="deposit">Deposit (in)</option>
                      <option value="withdrawal">Withdrawal (out)</option>
                    </select>
                    <input type="text" inputMode="decimal" value={tAmount} onChange={(e) => setTAmount(e.target.value)} placeholder="Amount (e.g. 20.00)" aria-label="Amount" className={inputCls} />
                    <select value={tCategory} onChange={(e) => setTCategory(e.target.value)} aria-label="Category" className={inputCls}>
                      {TRUST_CATEGORIES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                    <input type="text" value={tDesc} onChange={(e) => setTDesc(e.target.value)} placeholder="Description" aria-label="Description" className={cn(inputCls, "lg:col-span-2")} />
                    <Button type="button" disabled={busy} onClick={() => void postTrust()} className="gap-2">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                      Post
                    </Button>
                  </div>
                  {trustTx.length === 0 ? (
                    <p className="text-sm text-muted-foreground pl-2">No transactions yet.</p>
                  ) : (
                    <ul className="space-y-2">
                      {trustTx.map((t) => (
                        <li key={t.id} className="flex items-center justify-between gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-medium text-foreground truncate">{t.description}</span>
                            <span className="text-xs text-muted-foreground">
                              {ET_FMT.format(new Date(t.occurred_at))} · {categoryLabel(TRUST_CATEGORIES, t.category)}
                            </span>
                          </div>
                          <div className="text-right shrink-0">
                            <span className={cn("font-semibold tabular-nums", t.direction === "deposit" ? "text-success" : "text-foreground")}>
                              {t.direction === "deposit" ? "+" : "−"}{formatCents(t.amount_cents)}
                            </span>
                            <p className="text-xs text-muted-foreground tabular-nums">bal {formatCents(t.balance_after_cents)}</p>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
