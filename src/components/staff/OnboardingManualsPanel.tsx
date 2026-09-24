"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { KnowledgeMarkdown } from "@/components/knowledge/KnowledgeMarkdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatDisplayDateTime } from "@/lib/format/datetime";
import {
  ONBOARDING_MANUAL_ATTESTATION,
  manualChangedSinceSigning,
  signoffMethodLabel,
  summarizeOnboardingManuals,
  type OnboardingManualMethod,
  type OnboardingManualStatus,
} from "@/lib/staff/onboarding-manuals";

type OpenManual = { id: string; title: string; text: string };

/**
 * COL-740: the P&P manuals this employee signs at onboarding, inside the
 * employee file. Renders nothing when no manual is required of this person —
 * existing staff and roles nobody configured never see it.
 */
export function OnboardingManualsPanel({
  staffId,
  selfService,
  canManage,
  isSelf,
  onLoaded,
}: {
  staffId: string;
  selfService: boolean;
  canManage: boolean;
  isSelf: boolean;
  /** The rows once loaded, or null when they could not be read (readiness must not treat that as signed). */
  onLoaded: (rows: OnboardingManualStatus[] | null) => void;
}) {
  const endpoint = `/api/admin/staff/${staffId}/employee-file/manuals`;
  const [rows, setRows] = useState<OnboardingManualStatus[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<OpenManual | null>(null);
  const [method, setMethod] = useState<OnboardingManualMethod>("self");
  const [name, setName] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(endpoint, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !Array.isArray(body.manuals)) throw new Error(body.error || "Onboarding manuals could not be loaded.");
      setRows(body.manuals);
      onLoaded(body.manuals);
    } catch (e) {
      setRows(null);
      setError(e instanceof Error ? e.message : "Onboarding manuals could not be loaded.");
      onLoaded(null);
    }
  }, [endpoint, onLoaded]);

  useEffect(() => {
    void load();
  }, [load]);

  async function openManual(documentId: string, signMethod: OnboardingManualMethod) {
    setSignError(null);
    setAgreed(false);
    setName("");
    setMethod(signMethod);
    try {
      const response = await fetch(`${endpoint}?document=${encodeURIComponent(documentId)}`, { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The manual could not be loaded.");
      setOpen({ id: body.document.id, title: body.document.title, text: body.document.text });
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "The manual could not be loaded.");
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!open || !agreed || name.trim().length < 3) return;
    setBusy(true);
    setSignError(null);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_id: open.id, signature_name: name.trim(), method }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Could not record the signature.");
      setOpen(null);
      await load();
    } catch (e) {
      setSignError(e instanceof Error ? e.message : "Could not record the signature.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <section className="space-y-2 rounded-lg border bg-card p-5" aria-label="Onboarding manuals">
        <h2 className="text-lg font-semibold">P&amp;P manuals to sign</h2>
        <p role="alert" className="text-sm">
          {error} Whether manuals are still unsigned is unknown.
        </p>
        <Button variant="outline" onClick={() => void load()}>
          Retry
        </Button>
      </section>
    );
  }
  if (rows === null) return null;
  const summary = summarizeOnboardingManuals(rows);
  if (summary.state === "none_required") return null;

  return (
    <section className="space-y-4 rounded-lg border bg-card p-5" aria-label="Onboarding manuals">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">P&amp;P manuals to sign</h2>
        <Badge variant={summary.state === "outstanding" ? "destructive" : "outline"} className="text-foreground">
          {summary.state === "outstanding"
            ? `${summary.signed} of ${summary.required} signed`
            : `All ${summary.required} signed`}
        </Badge>
      </div>
      <p className="text-sm text-muted-foreground">
        Part of onboarding: each manual below is signed once, stating it has been read and understood. Onboarding is not
        complete until every one is signed.
        {canManage && !selfService ? (
          <>
            {" "}
            <Link href="/admin/staff/onboarding-manuals" className="underline">
              Which manuals each job role signs
            </Link>
          </>
        ) : null}
      </p>
      <ul className="divide-y rounded-md border">
        {rows.map((row) => (
          <li key={row.document_id} className="flex flex-wrap items-start justify-between gap-3 p-3 text-sm">
            <div className="space-y-1">
              <p className="font-medium">{row.document_title}</p>
              {row.signoff_id && row.signed_at && row.method ? (
                <p className="text-muted-foreground">
                  Signed {formatDisplayDateTime(row.signed_at)} as “{row.signature_name}”, {signoffMethodLabel(row.method)}.
                  {manualChangedSinceSigning(row) ? " The manual has been revised since; no new signature is needed." : ""}
                </p>
              ) : (
                <p className="text-muted-foreground">Not signed yet.</p>
              )}
            </div>
            {!row.signoff_id ? (
              <div className="flex flex-wrap gap-2">
                {isSelf ? (
                  <Button size="sm" onClick={() => void openManual(row.document_id, "self")}>
                    Read and sign
                  </Button>
                ) : null}
                {canManage && !isSelf ? (
                  <Button size="sm" variant="outline" onClick={() => void openManual(row.document_id, "in_person")}>
                    Record in-person signature
                  </Button>
                ) : null}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {signError && !open ? <p role="alert" className="text-sm">{signError}</p> : null}
      {open ? (
        <form onSubmit={submit} className="space-y-4 rounded-md border p-4" aria-label={`Sign ${open.title}`}>
          <h3 className="font-semibold">{open.title}</h3>
          <div className="max-h-[28rem] overflow-y-auto rounded-md border bg-background p-4">
            <KnowledgeMarkdown source={open.text} className="space-y-2 text-sm" />
          </div>
          {method === "in_person" ? (
            <p className="text-sm text-muted-foreground">
              Use this only when the employee signs in front of you. You are recorded as the witness.
            </p>
          ) : null}
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-1" />
            <span>{ONBOARDING_MANUAL_ATTESTATION}</span>
          </label>
          <label className="grid gap-1.5 text-sm font-medium">
            {method === "self" ? "Type your full name to sign" : "Employee's full name, as they signed"}
            <Input value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
          </label>
          {signError ? <p role="alert" className="text-sm">{signError}</p> : null}
          <div className="flex gap-2">
            <Button type="submit" disabled={busy || !agreed || name.trim().length < 3}>
              {busy ? "Signing…" : "Sign"}
            </Button>
            <Button type="button" variant="outline" onClick={() => setOpen(null)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}
    </section>
  );
}
