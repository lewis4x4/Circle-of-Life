"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../../finance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { createClient } from "@/lib/supabase/client";
import { formatCents, parseDollarsToCents } from "@/lib/finance/format-cents";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];
type LineRow = Database["public"]["Tables"]["journal_entry_lines"]["Row"] & {
  account_code?: string;
  account_name?: string;
};

type FacilityMini = { id: string; name: string; entity_id: string };
type GlMini = { id: string; code: string; name: string };

type LineForm = {
  gl_account_id: string;
  debit: string;
  credit: string;
};

function parseFormLines(formLines: LineForm[]) {
  return formLines
    .map((l) => {
      const dc = parseDollarsToCents(l.debit);
      const cc = parseDollarsToCents(l.credit);
      return {
        gl_account_id: l.gl_account_id,
        debit_cents: dc && dc > 0 ? dc : 0,
        credit_cents: cc && cc > 0 ? cc : 0,
      };
    })
    .filter((l) => l.gl_account_id && (l.debit_cents > 0 || l.credit_cents > 0))
    .map((l, i) => ({ ...l, line_number: i + 1 }));
}

export default function JournalEntryDetailPage() {
  const params = useParams();
  const id = typeof params.id === "string" ? params.id : "";
  const router = useRouter();
  const supabase = createClient();
  const [ctx, setCtx] = useState<Awaited<ReturnType<typeof loadFinanceRoleContext>> | null>(null);
  const [header, setHeader] = useState<JournalRow | null>(null);
  const [lines, setLines] = useState<LineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
      const c = await loadFinanceRoleContext(supabase);
      setCtx(c);
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

      if (c.ok && canMutateFinance(c.ctx.appRole) && hRow.status === "draft") {
        const [{ data: fac }, { data: accs }] = await Promise.all([
          supabase
            .from("facilities")
            .select("id, name, entity_id")
            .eq("organization_id", c.ctx.organizationId)
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
                gl_account_id: l.gl_account_id,
                debit: l.debit_cents ? (l.debit_cents / 100).toFixed(2) : "",
                credit: l.credit_cents ? (l.credit_cents / 100).toFixed(2) : "",
              }))
            : [];
        while (fl.length < 2) {
          fl.push({ gl_account_id: "", debit: "", credit: "" });
        }
        setFormLines(fl);
      } else {
        setFormLines([]);
      }
    } finally {
      setLoading(false);
    }
  }, [supabase, id]);

  useEffect(() => {
    void load();
  }, [load]);

  function setLine(i: number, patch: Partial<LineForm>) {
    setFormLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

  function addLine() {
    setFormLines((prev) => [...prev, { gl_account_id: "", debit: "", credit: "" }]);
  }

  function removeLine(i: number) {
    setFormLines((prev) => (prev.length <= 2 ? prev : prev.filter((_, j) => j !== i)));
  }

  async function saveDraft() {
    if (!header || header.status !== "draft" || !ctx?.ok || !canMutateFinance(ctx.ctx.appRole)) return;
    const parsed = parseFormLines(formLines);
    if (parsed.length < 2) {
      setError("Add at least two lines with accounts and a debit or credit amount.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const { error: uErr } = await supabase
        .from("journal_entries")
        .update({
          entry_date: formEntryDate,
          memo: formMemo.trim() || null,
          facility_id: formFacilityId || null,
        })
        .eq("id", header.id)
        .eq("status", "draft");
      if (uErr) {
        setError(uErr.message);
        return;
      }
      const { error: dErr } = await supabase.from("journal_entry_lines").delete().eq("journal_entry_id", header.id);
      if (dErr) {
        setError(dErr.message);
        return;
      }
      const inserts: Database["public"]["Tables"]["journal_entry_lines"]["Insert"][] = parsed.map((l) => ({
        journal_entry_id: header.id,
        organization_id: ctx.ctx.organizationId,
        gl_account_id: l.gl_account_id,
        line_number: l.line_number,
        debit_cents: l.debit_cents,
        credit_cents: l.credit_cents,
      }));
      const { error: iErr } = await supabase.from("journal_entry_lines").insert(inserts);
      if (iErr) {
        setError(iErr.message);
        return;
      }
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function deleteDraft() {
    if (!header || header.status !== "draft" || !ctx?.ok || !canMutateFinance(ctx.ctx.appRole)) return;
    if (!globalThis.confirm("Delete this draft journal entry? This cannot be undone.")) return;
    setDeleting(true);
    setError(null);
    try {
      const { error: delErr } = await supabase.from("journal_entries").delete().eq("id", header.id).eq("status", "draft");
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
    if (!header || header.status !== "draft" || !ctx?.ok || !canMutateFinance(ctx.ctx.appRole)) return;
    setPosting(true);
    setError(null);
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Not signed in");
        return;
      }
      const { error: upErr } = await supabase
        .from("journal_entries")
        .update({
          status: "posted",
          posted_at: new Date().toISOString(),
          posted_by: user.id,
        })
        .eq("id", header.id)
        .eq("status", "draft");
      if (upErr) {
        setError(upErr.message);
        return;
      }
      await load();
      router.refresh();
    } finally {
      setPosting(false);
    }
  }

  const canEditDraft = Boolean(ctx?.ok && canMutateFinance(ctx.ctx.appRole) && header?.status === "draft");

  let debitSum = 0;
  let creditSum = 0;
  if (canEditDraft) {
    for (const l of formLines) {
      const dc = parseDollarsToCents(l.debit) ?? 0;
      const cc = parseDollarsToCents(l.credit) ?? 0;
      debitSum += dc;
      creditSum += cc;
    }
  } else {
    for (const l of lines) {
      debitSum += l.debit_cents;
      creditSum += l.credit_cents;
    }
  }
  const balanced = debitSum === creditSum && debitSum > 0;

  return (
    <div className="space-y-6">
      <FinanceHubNav />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-white">Journal entry</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            {loading ? "Loading…" : header ? `${header.entry_date} · ${header.status}` : "—"}
          </p>
        </div>
        <Link className={cn(buttonVariants({ variant: "outline", size: "sm" }))} href="/admin/finance/journal-entries">
          Back to list
        </Link>
      </div>

      {error ? (
        <p className="text-sm text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : null}

      {header ? (
        <>
          {canEditDraft ? (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Header</CardTitle>
                  <CardDescription>Entity is fixed for this entry. Adjust date, memo, and optional facility.</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2 md:col-span-2">
                    <Label>Entity</Label>
                    <p className="text-sm text-slate-700 dark:text-slate-300">{entityName || header.entity_id}</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="je-fac-edit">Facility (optional)</Label>
                    <select
                      id="je-fac-edit"
                      className={cn(
                        "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
                      )}
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
                  <div className="md:col-span-2 text-sm text-slate-700 dark:text-slate-300">
                    Line totals: debit {formatCents(debitSum)} · credit {formatCents(creditSum)}{" "}
                    {balanced ? (
                      <span className="text-emerald-700 dark:text-emerald-400">(balanced)</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">(not balanced)</span>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Lines</CardTitle>
                  <CardDescription>Each line is debit XOR credit (USD). Minimum two lines.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {formLines.map((line, i) => (
                    <div key={i} className="grid gap-2 md:grid-cols-5 md:items-end">
                      <div className="space-y-1 md:col-span-2">
                        <Label>Account</Label>
                        <select
                          className={cn(
                            "flex h-10 w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm dark:border-slate-800 dark:bg-slate-950",
                          )}
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
                          value={line.debit}
                          onChange={(e) => setLine(i, { debit: e.target.value, credit: "" })}
                        />
                      </div>
                      <div className="space-y-1">
                        <Label>Credit $</Label>
                        <Input
                          inputMode="decimal"
                          value={line.credit}
                          onChange={(e) => setLine(i, { credit: e.target.value, debit: "" })}
                        />
                      </div>
                      <div className="flex md:pb-2">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-slate-600"
                          disabled={formLines.length <= 2}
                          onClick={() => removeLine(i)}
                        >
                          Remove
                        </Button>
                      </div>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    Add line
                  </Button>
                </CardContent>
              </Card>

              <div className="flex flex-wrap items-center gap-3">
                <Button type="button" onClick={() => void saveDraft()} disabled={saving}>
                  {saving ? "Saving…" : "Save draft"}
                </Button>
                <Button type="button" variant="destructive" onClick={() => void deleteDraft()} disabled={deleting}>
                  {deleting ? "Deleting…" : "Delete draft"}
                </Button>
                <Button type="button" onClick={() => void postEntry()} disabled={posting || !balanced}>
                  {posting ? "Posting…" : "Post entry"}
                </Button>
                {!balanced ? (
                  <span className="text-sm text-amber-800 dark:text-amber-300">
                    Debits must equal credits with a non-zero total to post.
                  </span>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Header</CardTitle>
                  <CardDescription>{header.memo ?? "No memo"}</CardDescription>
                </CardHeader>
                <CardContent className="text-sm text-slate-700 dark:text-slate-300">
                  <p>Entity: {entityName || header.entity_id}</p>
                  <p>Status: {header.status}</p>
                  {header.posted_at ? <p>Posted: {header.posted_at}</p> : null}
                  <p className="mt-2">
                    Line totals: debit {formatCents(debitSum)} · credit {formatCents(creditSum)}{" "}
                    {balanced ? (
                      <span className="text-emerald-700 dark:text-emerald-400">(balanced)</span>
                    ) : (
                      <span className="text-amber-700 dark:text-amber-400">(not balanced)</span>
                    )}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Lines</CardTitle>
                </CardHeader>
                <CardContent>
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
                            {l.debit_cents ? formatCents(l.debit_cents) : "—"}
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
                            {l.credit_cents ? formatCents(l.credit_cents) : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>

              {header.status === "posted" ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">Posted entries are read-only.</p>
              ) : null}
              {header.status === "voided" ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">Voided entries are read-only.</p>
              ) : null}
              {header.status === "draft" && !canEditDraft ? (
                <p className="text-sm text-slate-600 dark:text-slate-400">Draft (read-only for your role).</p>
              ) : null}
            </>
          )}
        </>
      ) : null}
    </div>
  );
}
