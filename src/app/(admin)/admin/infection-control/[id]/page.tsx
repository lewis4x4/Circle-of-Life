"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase/client";
import {
  RecordDetailHeader,
  RecordDetailSection,
} from "@/design-system/components/record-detail";

export default function InfectionSurveillanceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id ?? "";
  const supabase = useMemo(() => createClient(), []);
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState("");
  const [reviewStatus, setReviewStatus] = useState("Outbreak review can be retried without creating another record.");
  const [row, setRow] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    const { data, error: qErr } = await supabase
      .from("infection_surveillance")
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (qErr) {
      setError(qErr.message);
      return;
    }
    setRow(data as Record<string, unknown>);
  }, [supabase, id]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  async function updateStatus(status: "confirmed" | "resolved") {
    if (!row || busy || !notes.trim()) return;
    setBusy(true); setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Sign in again.");
      const result = await supabase.from("infection_surveillance").update({ status, outcome_notes: notes, resolved_date: status === "resolved" ? new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date()) : null, updated_by: user.id }).eq("id", id).eq("status", String(row.status)).select("id").single();
      if (result.error) throw result.error;
      setNotes(""); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not update surveillance."); } finally { setBusy(false); }
  }
  async function evaluate() {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/infection-control/evaluate-outbreak", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ surveillanceId: id }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Outbreak review failed");
      setReviewStatus("Outbreak evaluation completed."); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Outbreak review unavailable"); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <RecordDetailHeader
        title="Surveillance record"
        backLink={{ label: "Infection control", href: "/admin/infection-control" }}
      />
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
      {row && (
        <RecordDetailSection
          title="Summary"
          description={`ID: ${String(row.id)}`}
        >
          <div className="space-y-2 text-sm">
            <Link href={`/admin/residents/${String(row.resident_id)}`} className="underline">Open resident record</Link>
            <p>Symptoms: {Array.isArray(row.symptoms) ? row.symptoms.join(", ") : "Unavailable"}</p>
            <p>Prior outcome notes: {String(row.outcome_notes ?? "None recorded")}</p>
            <p>{reviewStatus}</p><button disabled={busy} onClick={() => void evaluate()} className="underline">Retry outbreak evaluation</button>
            <label className="block">Clinical update / resolution evidence<textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="block w-full rounded border p-3" /></label>
            <div className="flex gap-4"><button disabled={busy || !notes.trim() || row.status !== "suspected"} onClick={() => void updateStatus("confirmed")}>Confirm case</button><button disabled={busy || !notes.trim() || row.status === "resolved"} onClick={() => void updateStatus("resolved")}>Resolve case</button></div>
            <p>
              <span className="text-muted-foreground">Type:</span>{" "}
              {String(row.infection_type)}
            </p>
            <p>
              <span className="text-muted-foreground">Status:</span>{" "}
              {String(row.status)}
            </p>
            <p>
              <span className="text-muted-foreground">Onset:</span>{" "}
              {String(row.onset_date)}
            </p>
            {row.outbreak_id ? (
              <p>
                <span className="text-muted-foreground">Outbreak:</span>{" "}
                <Link
                  href={`/admin/infection-control/outbreaks/${String(row.outbreak_id)}`}
                  className="text-sm font-medium underline-offset-4 hover:underline"
                >
                  View
                </Link>
              </p>
            ) : null}
          </div>
        </RecordDetailSection>
      )}
    </div>
  );
}
