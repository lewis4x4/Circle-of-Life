"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { FinanceHubNav } from "../../finance-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { createClient } from "@/lib/supabase/client";
import { formatCents } from "@/lib/finance/format-cents";
import { canMutateFinance, loadFinanceRoleContext } from "@/lib/finance/load-finance-context";
import { cn } from "@/lib/utils";
import type { Database } from "@/types/database";

type JournalRow = Database["public"]["Tables"]["journal_entries"]["Row"];
type LineRow = Database["public"]["Tables"]["journal_entry_lines"]["Row"] & {
  account_code?: string;
  account_name?: string;
};

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
      setHeader(h as JournalRow);
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
      setLines(
        raw.map((r) => ({
          ...r,
          account_code: map.get(r.gl_account_id)?.code,
          account_name: map.get(r.gl_account_id)?.name,
        })),
      );
    } finally {
      setLoading(false);
    }
  }, [supabase, id]);

  useEffect(() => {
    void load();
  }, [load]);

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

  const canPost =
    ctx?.ok &&
    canMutateFinance(ctx.ctx.appRole) &&
    header?.status === "draft";

  let debitSum = 0;
  let creditSum = 0;
  for (const l of lines) {
    debitSum += l.debit_cents;
    creditSum += l.credit_cents;
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
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Header</CardTitle>
              <CardDescription>{header.memo ?? "No memo"}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-slate-700 dark:text-slate-300">
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

          {canPost ? (
            <div className="flex items-center gap-3">
              <Button type="button" onClick={() => void postEntry()} disabled={posting || !balanced}>
                {posting ? "Posting…" : "Post entry"}
              </Button>
              {!balanced ? (
                <span className="text-sm text-amber-800 dark:text-amber-300">
                  Debits must equal credits with a non-zero total to post.
                </span>
              ) : null}
            </div>
          ) : null}

          {header.status === "posted" ? (
            <p className="text-sm text-slate-600 dark:text-slate-400">Posted entries are read-only.</p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
