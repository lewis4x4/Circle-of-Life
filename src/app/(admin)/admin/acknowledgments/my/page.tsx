"use client";

import Link from "next/link";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { getDashboardRouteForRole } from "@/lib/auth/dashboard-routing";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileCheck2, Loader2, PenLine } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  roleLabel,
  type AcknowledgmentRow,
  type AckRequirementRow,
  type QueryError,
  type QueryResult,
} from "@/lib/office/acknowledgments";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

type MyProfile = { id: string; full_name: string; app_role: string };

export default function MyAcknowledgmentsPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [requirements, setRequirements] = useState<AckRequirementRow[]>([]);
  const [myAcks, setMyAcks] = useState<AcknowledgmentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { appRole } = useHavenAuth();
  const [readingId, setReadingId] = useState<string | null>(null);
  const [signingId, setSigningId] = useState<string | null>(null);
  const [signatureName, setSignatureName] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const profileQ = supabase
        .from("user_profiles")
        .select("id, full_name, app_role")
        .eq("id", actor.userId)
        .single();
      const requirementsQ = supabase
        .from("document_acknowledgment_requirements" as never)
        .select(
          "id, document_id, document_title, required_roles, require_signature, due_date, note, is_active, created_at, document_content_snapshot, document_version_hash",
        )
        .eq("facility_id", selectedFacilityId as string)
        .eq("is_active", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false });
      const myAcksQ = supabase
        .from("document_acknowledgments" as never)
        .select("id, requirement_id, document_id, user_id, signature_name, signer_role, acknowledged_at")
        .eq("user_id", actor.userId)
        .is("deleted_at", null);

      const [profileRes, reqRes, ackRes] = await Promise.all([
        profileQ as unknown as Promise<{ data: MyProfile | null; error: QueryError | null }>,
        requirementsQ as unknown as Promise<QueryResult<AckRequirementRow>>,
        myAcksQ as unknown as Promise<QueryResult<AcknowledgmentRow>>,
      ]);
      const err: QueryError | null = profileRes.error ?? reqRes.error ?? ackRes.error;
      if (err) throw new Error(err.message);
      setProfile(profileRes.data);
      setRequirements(reqRes.data ?? []);
      setMyAcks(ackRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load your acknowledgments.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const signedIds = useMemo(
    () => new Set(myAcks.map((a) => a.requirement_id)),
    [myAcks],
  );

  const applicable = useMemo(
    () =>
      profile
        ? requirements.filter((r) => r.required_roles.includes(profile.app_role))
        : [],
    [requirements, profile],
  );

  const outstanding = applicable.filter((r) => !signedIds.has(r.id));
  const completed = applicable.filter((r) => signedIds.has(r.id));

  const sign = useCallback(
    async (requirement: AckRequirementRow) => {
      if (!profile) return;
      const typed = signatureName.trim();
      if (requirement.require_signature && typed.length < 3) return;
      setBusy(true);
      setNotice(null);
      try {
        const actor = await fetchActorContext(supabase);
        if (!actor) throw new Error("Could not resolve your profile.");
        const { error } = await supabase.from("document_acknowledgments" as never).insert({
          organization_id: actor.organizationId,
          facility_id: selectedFacilityId as string,
          requirement_id: requirement.id,
          document_id: requirement.document_id,
          user_id: actor.userId,
          signature_name: requirement.require_signature ? typed : profile.full_name,
          signer_role: profile.app_role,
          created_by: actor.userId,
          updated_by: actor.userId,
        } as never);
        if (error) throw new Error(error.message);
        setSigningId(null);
        setSignatureName("");
        await load();
      } catch (err) {
        setNotice(err instanceof Error ? err.message : "Failed to record your signature.");
      } finally {
        setBusy(false);
      }
    },
    [supabase, profile, signatureName, selectedFacilityId, load],
  );

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6 max-w-3xl">
        <header className="mb-6 space-y-2">
          <Link
            href={getDashboardRouteForRole(appRole)}
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Policy acknowledgments
          </Link>
          <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
            <FileCheck2 className="h-8 w-8 text-info shrink-0" aria-hidden />
            My acknowledgments
          </h2>
          <p className="text-sm text-muted-foreground">
            Policies and SOPs assigned to your role. Read the document, then sign by typing your
            full legal name — the signature is permanent.
          </p>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first.
          </p>
        ) : null}

        {notice ? (
          <p className="rounded-[var(--radius)] border border-danger/30 bg-danger/10 px-6 py-3 text-sm text-danger">
            {notice}
          </p>
        ) : null}

        {facilityReady && isLoading ? <AdminTableLoadingState /> : null}
        {facilityReady && !isLoading && loadError ? (
          <AdminLiveDataFallbackNotice message={loadError} onRetry={() => void load()} />
        ) : null}

        {facilityReady && !isLoading && !loadError ? (
          <>
            <section aria-labelledby="my-outstanding-heading" className="space-y-3">
              <div className="px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="my-outstanding-heading" className="text-lg font-semibold text-foreground">
                  Waiting on you
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {outstanding.length}
                  </span>
                </h3>
              </div>
              {outstanding.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  Nothing outstanding — you are caught up.
                </p>
              ) : (
                <ul className="space-y-2">
                  {outstanding.map((r) => {
                    const signing = signingId === r.id;
                    return (
                      <li key={r.id} className="rounded-[9px] border border-border bg-card px-[13px] py-3 space-y-2">
                        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
                          <div className="flex flex-col gap-0.5 min-w-0">
                            <span className="font-semibold text-foreground truncate">
                              {r.document_title}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {r.due_date ? `Due ${r.due_date} · ` : ""}
                              {r.require_signature ? "Typed-name e-signature" : "Mark as read"}
                              {r.note ? ` · ${r.note}` : ""}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <Button type="button" variant="outline" size="sm" onClick={() => setReadingId(readingId === r.id ? null : r.id)}>Read document</Button>
                            <Button
                              type="button"
                              size="sm"
                              className="gap-2"
                              disabled={!r.document_version_hash || readingId !== r.id}
                              onClick={() => {
                                setSigningId(signing ? null : r.id);
                                setSignatureName("");
                              }}
                            >
                              <PenLine className="h-4 w-4" aria-hidden />
                              {r.require_signature ? "Sign" : "Mark as read"}
                            </Button>
                          </div>
                        </div>
                        {readingId === r.id && <div className="rounded-lg border border-border p-4"><h3 className="font-medium mb-2">{r.document_title}</h3><p className="whitespace-pre-wrap text-sm">{r.document_content_snapshot || "This older requirement has no issued content snapshot. Ask an administrator to reissue it before signing."}</p></div>}
                      {signing ? (
                          <div className="space-y-2 border-t border-border pt-3">
                            {r.require_signature ? (
                              <label className="flex flex-col gap-1 text-sm">
                                <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                                  Type your full legal name as your signature
                                </span>
                                <input
                                  type="text"
                                  value={signatureName}
                                  onChange={(e) => setSignatureName(e.target.value)}
                                  placeholder={profile?.full_name ?? "Full legal name"}
                                  className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                                />
                              </label>
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                Confirm you have read and understood this document.
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              By {r.require_signature ? "signing" : "confirming"}, I acknowledge I
                              have read and understood “{r.document_title}”. This record is
                              permanent and auditable.
                            </p>
                            <Button
                              type="button"
                              size="sm"
                              disabled={
                                busy ||
                                (r.require_signature && signatureName.trim().length < 3)
                              }
                              onClick={() => void sign(r)}
                              className="gap-2"
                            >
                              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                              Confirm {r.require_signature ? "signature" : "read"}
                            </Button>
                          </div>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>

            <section aria-labelledby="my-completed-heading" className="space-y-3">
              <div className="px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="my-completed-heading" className="text-lg font-semibold text-foreground">
                  Completed
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {completed.length}
                  </span>
                </h3>
              </div>
              {completed.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">No signatures yet.</p>
              ) : (
                <ul className="space-y-2">
                  {completed.map((r) => {
                    const ack = myAcks.find((a) => a.requirement_id === r.id);
                    return (
                      <li
                        key={r.id}
                        className="flex flex-col gap-2 px-[13px] py-2 rounded-[9px] border border-border bg-card lg:flex-row lg:items-center lg:justify-between"
                      >
                        <div className="flex flex-col gap-0.5 min-w-0">
                          <span className="font-semibold text-foreground truncate">
                            {r.document_title}
                          </span>
                          {ack ? (
                            <span className="text-xs text-muted-foreground">
                              Signed “{ack.signature_name}” ({roleLabel(ack.signer_role)}) ·{" "}
                              {ET_FMT.format(new Date(ack.acknowledged_at))} ET
                            </span>
                          ) : null}
                        </div>
                        <StatusPill tone="success">signed</StatusPill>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
