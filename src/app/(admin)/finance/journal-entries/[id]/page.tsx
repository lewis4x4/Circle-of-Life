"use client";

import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../../finance-hub-nav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RecordDetailHeader, RecordDetailSection } from "@/design-system/components/record-detail";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { postInvoiceToGl, postPaymentToGl } from "@/lib/finance/post-to-gl";
import { formatCents } from "@/lib/finance/format-cents";
import { parseJournalFormLines } from "@/lib/finance/journal-form-lines";
import { formatUsdFromCents } from "@/lib/insurance/format-money";
import { canCreateDraftFinance, canPostFinance } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";
import { todayFacilityDateIso } from "@/lib/facility-wall-clock";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];
type LineRow = Database["public"]["Tables"]["journal_entry_lines"]["Row"] & {
  account_code?: string;
  account_name?: string;
};

type FacilityMini = { id: string; name: string; entity_id: string };
type GlMini = { id: string; code: string; name: string };

type LineForm = {
  _key: string;
  gl_account_id: string;
  debit: string;
  credit: string;
};

let _lineSeq = 0;
function nextLineKey() {
  return `line-${++_lineSeq}-${Date.now()}`;
}


export default function JournalEntryDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const supabase = createClient();
  const { user, organizationId, appRole } = useHavenAuth();
  type AppRole = Database["public"]["Enums"]["app_role"];
  const role = appRole as AppRole;
  const [header, setHeader] = useState<JournalRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [reversing, setReversing] = useState(false);
  const [reversalDate, setReversalDate] = useState(todayFacilityDateIso);
  const [reversalReason, setReversalReason] = useState("");

  const [entityName, setEntityName] = useState("");
  const [facilities, setFacilities] = useState<FacilityMini[]>([]);
  const [accounts, setAccounts] = useState<GlMini[]>([]);
  const [formEntryDate, setFormEntryDate] = useState("");
  const [formMemo, setFormMemo] = useState("");
  const [formFacilityId, setFormFacilityId] = useState("");
  const [formLines, setFormLines] = useState<LineForm[]>([]);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const { data: h, error: hErr } = await supabase.from("journal_entries").select("*").eq("id", id).maybeSingle();
      if (hErr || !h) {
        setError(hErr?.message ?? "Not found");
        setHeader(null);
        return;
      }
      const hRow = h as JournalRow;
      setHeader(hRow);

      const { data: entRow } = await supabase.from("entities").select("name").eq("id", hRow.entity_id).maybeSingle();
      setEntityName((entRow as { name: string } | null)?.name ?? "");

      const { data: ln, error: lErr } = await supabase
        .from("journal_entry_lines")
        .select("*")
        .eq("journal_entry_id", id)
        .is("deleted_at", null)
        .order("line_number");
      if (lErr) {
        setError(lErr.message);
        return;
      }
      const raw = (ln ?? []) as Database["public"]["Tables"]["journal_entry_lines"]["Row"][];
      const accIds = [...new Set(raw.map((r) => r.gl_account_id))];
      const map = new Map<string, { id: string; code: string; name: string }>();
      if (accIds.length > 0) {
        const { data: accs } = await supabase.from("gl_accounts").select("id, code, name").in("id", accIds);
        for (const a of accs ?? []) {
          map.set(a.id, a as { id: string; code: string; name: string });
        }
      }
      const rowsWithAccounts = raw.map((r) => ({
        ...r,
        account_code: map.get(r.gl_account_id)?.code,
        account_name: map.get(r.gl_account_id)?.name,
      }));
      setLines(rowsWithAccounts);

      if (organizationId && canCreateDraftFinance(role) && hRow.status === "draft" && hRow.source_type === "manual") {
        const [{ data: fac }, { data: accs }] = await Promise.all([
          supabase
            .from("facilities")
            .select("id, name, entity_id")
            .eq("organization_id", organizationId)
            .is("deleted_at", null)
            .order("name"),
          supabase
            .from("gl_accounts")
            .select("id, code, name")
            .eq("entity_id", hRow.entity_id)
            .is("deleted_at", null)
            .order("code"),
        ]);
        setFacilities((fac ?? []) as FacilityMini[]);
        setAccounts((accs ?? []) as GlMini[]);
        setFormEntryDate(hRow.entry_date);
        setFormMemo(hRow.memo ?? "");
        setFormFacilityId(hRow.facility_id ?? "");
        const fl: LineForm[] =
          rowsWithAccounts.length > 0
            ? rowsWithAccounts.map((l) => ({
                _key: nextLineKey(),
                gl_account_id: l.gl_account_id,
                debit: l.debit_cents ? (l.debit_cents / 100).toFixed(2) : "",
                credit: l.credit_cents ? (l.credit_cents / 100).toFixed(2) : "",
              }))
            : [];
        while (fl.length < 2) {
          fl.push({ _key: nextLineKey(), gl_account_id: "", debit: "", credit: "" });
        }
        setFormLines(fl);
      } else {
        setFormLines([]);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, id, organizationId, role]);

  useEffect(() => {
    void load();
  }, [load]);

  function setLine(i: number, patch: Partial<LineForm>) {
    setFormLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setFormLines((prev) => [...prev, { _key: nextLineKey(), gl_account_id: "", debit: "", credit: "" }]);
  }

  function removeLine(key: string) {
    setFormLines((prev) => (prev.length <= 2 ? prev : prev.filter((l) => l._key !== key)));
  }

  async function saveDraft() {
    if (!header || header.status !== "draft" || !organizationId || !canCreateDraftFinance(role)) return;
    const result = parseJournalFormLines(formLines);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const parsed = result.lines;
    if (parsed.length < 2) {
      setError("Add at least two lines with accounts and a debit or credit amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: saveError } = await supabase.rpc("save_journal_draft" as never, {
        p_id: header.id, p_entity_id: header.entity_id, p_facility_id: formFacilityId || null,
        p_entry_date: formEntryDate, p_memo: formMemo.trim() || null, p_lines: parsed,
        p_expected_updated_at: header.updated_at,
      } as never);
      if (saveError) { setError(saveError.message); return; }
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft() {
    if (!header || header.status !== "draft" || !organizationId || !canCreateDraftFinance(role)) return;
    if (!globalThis.confirm("Remove this draft journal entry? It will be hidden from lists but retained for audit.")) return;
    setDeleting(true);
    setError(null);
    try {
      const removedAt = new Date().toISOString();
      const { error: delErr } = await supabase
        .from("journal_entries")
        .update({ deleted_at: removedAt })
        .eq("id", header.id)
        .eq("status", "draft")
        .is("deleted_at", null);
      if (delErr) {
        setError(delErr.message);
        return;
      }
      router.push("/admin/finance/journal-entries");
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  async function postEntry() {
    if (!header || header.status !== "draft" || !organizationId || !canPostFinance(role)) return;
    setPosting(true);
    setError(null);
    try {
      if (!user?.id) {
        setError("Not signed in");
        return;
      }
      if (header.source_type === "invoice" || header.source_type === "payment") {
        if (!header.source_id) throw new Error("Journal source identity is missing.");
        const result = await (header.source_type === "invoice" ? postInvoiceToGl : postPaymentToGl)(supabase, header.source_id);
        if (!result.ok) { setError(result.error); return; }
      } else {
        const { data, error: upErr } = await supabase.rpc("post_finance_journal", {
          p_id: header.id,
          p_expected_updated_at: header.updated_at,
        });
        if (upErr) { setError(upErr.message); return; }
        if (!data || typeof data !== "object" || Array.isArray(data) || data.journal_entry_id !== header.id) {
          setError("Posting receipt unavailable. Reload and retry."); return;
        }
      }
      await load();
      router.refresh();
    } finally {
      setPosting(false);
    }
  }

  async function reverseEntry() {
    if (!header || !user?.id || !canPostFinance(role) || reversing || !reversalReason.trim()) return;
    setReversing(true);
    setError(null);
    try {
      const { data: authData, error: authError } = await supabase.auth.getClaims();
      const sessionId = authData?.claims.session_id;
      if (authError || authData?.claims.sub !== user.id || typeof sessionId !== "string") throw new Error("Sign in before reversing a journal.");
      const identityKey = `haven:finance:reversal:${user.id}:${header.id}`;
      const stored = sessionStorage.getItem(identityKey);
      const pending = stored ? JSON.parse(stored) as { id: string; date: string; reason: string } : {
        id: crypto.randomUUID(), date: reversalDate, reason: reversalReason.trim(),
      };
      if (typeof pending.id !== "string" || typeof pending.date !== "string" || typeof pending.reason !== "string") {
        throw new Error("Stored reversal needs reconciliation. Keep this tab open.");
      }
      if (pending.date !== reversalDate || pending.reason !== reversalReason.trim()) {
        setReversalDate(pending.date);
        setReversalReason(pending.reason);
        throw new Error("Restored the unresolved reversal details. Retry this request before entering a different reversal.");
      }
      const commandId = pending.id;
      sessionStorage.setItem(identityKey, JSON.stringify(pending));
      const { data, error: commandError } = await supabase.rpc("reverse_finance_journal", {
        p_id: commandId, p_journal_id: header.id, p_entry_date: reversalDate, p_reason: reversalReason.trim(),
      });
      if (commandError) throw commandError;
      if (!data || typeof data !== "object" || Array.isArray(data) || data.journal_entry_id !== commandId) {
        throw new Error("Reversal receipt unavailable. Retry to recover the result.");
      }
      sessionStorage.removeItem(identityKey);
      router.push(`/admin/finance/journal-entries/${commandId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : (err as { message?: string })?.message ?? "Could not reverse journal.");
    } finally {
      setReversing(false);
    }
  }

  const canEditDraft = Boolean(organizationId && canCreateDraftFinance(role) && header?.status === "draft" && header.source_type === "manual");
  const canPostEntry = Boolean(organizationId && canPostFinance(role) && header?.status === "draft");

  const parsedDraft = parseJournalFormLines(formLines);
  const debitSum = canEditDraft ? (parsedDraft.ok ? parsedDraft.debitCents : null) : lines.reduce((sum, line) => sum + line.debit_cents, 0);
  const creditSum = canEditDraft ? (parsedDraft.ok ? parsedDraft.creditCents : null) : lines.reduce((sum, line) => sum + line.credit_cents, 0);
  const balanced = debitSum !== null && creditSum !== null && debitSum === creditSum && debitSum > 0;
  const draftHasChanges = canEditDraft && header && (
    !parsedDraft.ok || formEntryDate !== header.entry_date || formMemo !== (header.memo ?? "") || formFacilityId !== (header.facility_id ?? "") ||
    JSON.stringify(parsedDraft.lines) !== JSON.stringify(lines.map((line) => ({ gl_account_id: line.gl_account_id, debit_cents: line.debit_cents, credit_cents: line.credit_cents, line_number: line.line_number })))
  );

  const headerSubtitle = loading
    ? "Loading…"
    : header
      ? `${header.entry_date} · ${header.status}`
      : "Journal entry not loaded";

  const selectCls = cn(
    "flex h-10 w-full rounded-md border border-border bg-card px-3 py-2 text-sm",
  );

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <RecordDetailHeader
        title="Journal entry"
        subtitle={headerSubtitle}
        backLink={{ label: "Back to list", href: "/admin/finance/journal-entries" }}
      />

      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {header ? (
        <>
          {canEditDraft ? (
            <>
              <RecordDetailSection
                title="Header"
                description="Entity is fixed for this entry. Adjust date, memo, and optional facility."
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Entity</Label>
                    <p className="text-sm text-foreground">{entityName || header.entity_id}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="je-fac-edit">Facility (optional)</Label>
                    <select
                      id="je-fac-edit"
                      className={selectCls}
                      value={formFacilityId}
                      onChange={(e) => setFormFacilityId(e.target.value)}
                    >
                      <option value="">Entity-level (no facility)</option>
                      {facilities.filter((f) => f.entity_id === header.entity_id).map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="je-date-edit">Entry date</Label>
                    <Input
                      id="je-date-edit"
                      type="date"
                      value={formEntryDate}
                      onChange={(e) => setFormEntryDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2 md:col-span-2">
                    <Label htmlFor="je-memo-edit">Memo</Label>
                    <Input id="je-memo-edit" value={formMemo} onChange={(e) => setFormMemo(e.target.value)} placeholder="Optional" />
                  </div>
                  <div className="md:col-span-2 text-sm text-foreground">
                    Line totals: debit {(debitSum === null ? "Invalid amount" : formatCents(debitSum))} · credit {(creditSum === null ? "Invalid amount" : formatCents(creditSum))}{" "}
                    {balanced ? (
                      <span className="text-emerald-700 dark:text-emerald-400">(balanced)</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">(not balanced)</span>
                    )}
                  </div>
                </div>
              </RecordDetailSection>

              <RecordDetailSection
                title="Lines"
                description="Each line is debit XOR credit (USD). Minimum two lines."
              >
                <div className="space-y-4">
                  {formLines.map((line, i) => (
                    <div key={line._key} className="grid gap-2 md:grid-cols-5 md:items-end">
                      <div className="space-y-1 md:col-span-2">
                        <Label>Account</Label>
                        <select
                          className={selectCls}
                          aria-label={`Account, line ${i + 1}`}
                  value={line.gl_account_id}
                          onChange={(e) => setLine(i, { gl_account_id: e.target.value })}
                        >
                          <option value="">Select…</option>
                          {accounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.code} — {a.name}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1">
                        <Label>Debit $</Label>
                        <Input
                          inputMode="decimal"
                          aria-label={`Debit dollars, line ${i + 1}`}
                  value={line.debit}
                          onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Credit $</Label>
                        <Input
                          inputMode="decimal"
                          aria-label={`Credit dollars, line ${i + 1}`}
                  value={line.credit}
                          onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                        />
                      </div>
                      <div className="flex md:pb-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground"
                          disabled={formLines.length <= 2}
                          onClick={() => removeLine(line._key)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    Add line
                  </Button>
                </div>
              </RecordDetailSection>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void saveDraft()} disabled={saving}>
                  {saving ? "Saving…" : "Save draft"}
                </Button>
                <Button type="button" variant="destructive" onClick={() => void deleteDraft()} disabled={deleting}>
                  {deleting ? "Removing…" : "Remove draft"}
                </Button>
                {canPostEntry ? (
                  <Button type="button" onClick={() => void postEntry()} disabled={posting || !balanced || Boolean(draftHasChanges)}>
                    {posting ? "Posting…" : "Post entry"}
                  </Button>
                ) : (
                  <span className="text-sm text-muted-foreground">Only owner / org admin can post entries.</span>
                )}
                {canPostEntry && draftHasChanges ? <p className="text-sm text-muted-foreground">Save draft changes before posting.</p> : null}
                {canPostEntry && !balanced ? (
                  <span className="text-sm text-amber-800 dark:text-amber-300">
                    Debits must equal credits with a non-zero total to post.
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <RecordDetailSection title="Header" description={header.memo ?? "No memo"}>
                <div className="space-y-1 text-sm text-foreground">
                  <p>Entity: {entityName || header.entity_id}</p>
                  <p>Status: {header.status}</p>
                  {header.posted_at ? <p>Posted: {header.posted_at}</p> : null}
                  <p className="mt-2">
                    Line totals: debit {(debitSum === null ? "Invalid amount" : formatCents(debitSum))} · credit {(creditSum === null ? "Invalid amount" : formatCents(creditSum))}{" "}
                    {balanced ? (
                      <span className="text-emerald-700 dark:text-emerald-400">(balanced)</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">(not balanced)</span>
                    )}
                  </p>
                </div>
              </RecordDetailSection>

              <RecordDetailSection title="Lines">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>#</TableHead>
                        <TableHead>Account</TableHead>
                        <TableHead className="text-right">Debit</TableHead>
                        <TableHead className="text-right">Credit</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {lines.map((l) => (
                        <TableRow key={l.id}>
                          <TableCell>{l.line_number}</TableCell>
                          <TableCell>
                            {l.account_code != null
                              ? `${l.account_code} — ${l.account_name ?? ""}`
                              : l.gl_account_id}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {l.debit_cents != null
                              ? formatUsdFromCents(l.debit_cents)
                              : "No debit posted"}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {l.credit_cents != null
                              ? formatUsdFromCents(l.credit_cents)
                              : "No credit posted"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </RecordDetailSection>

              {header.status === "posted" ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted-foreground">Posted entries are read-only. Corrections create a linked reversing journal.</p>
                  {canPostFinance(role) && header.source_type !== "reversal" ? (
                    <div className="grid max-w-lg gap-3">
                      <Label htmlFor="reversal-date">Reversal date</Label>
                      <Input id="reversal-date" type="date" value={reversalDate} onChange={(event) => setReversalDate(event.target.value)} />
                      <Label htmlFor="reversal-reason">Reason for reversal</Label>
                      <Input id="reversal-reason" value={reversalReason} onChange={(event) => setReversalReason(event.target.value)} />
                      <Button variant="outline" disabled={reversing || !reversalDate || !reversalReason.trim()} onClick={() => void reverseEntry()}>
                        {reversing ? "Posting reversal…" : "Post reversing journal"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {header.status === "voided" ? (
                <p className="text-sm text-muted-foreground">Voided entries are read-only.</p>
              ) : null}
              {header.status === "draft" && canPostEntry && (header.source_type === "invoice" || header.source_type === "payment") ? (
                <Button type="button" onClick={() => void postEntry()} disabled={posting}>{posting ? "Posting…" : "Recover source posting"}</Button>
              ) : null}
              {header.status === "draft" && !canEditDraft ? (
                <p className="text-sm text-muted-foreground">Draft (read-only for your role).</p>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
