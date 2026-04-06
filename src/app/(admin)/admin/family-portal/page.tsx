"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { Heart, MessageCircle } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import type { Database } from "@/types/database";
import { cn } from "@/lib/utils";

type TriageRow = Database["public"]["Tables"]["family_message_triage_items"]["Row"] & {
  family_portal_messages: { body: string } | null;
  residents: { first_name: string; last_name: string } | null;
};

type ConferenceRow = Database["public"]["Tables"]["family_care_conference_sessions"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

type ConsentRow = Database["public"]["Tables"]["family_consent_records"]["Row"] & {
  residents: { first_name: string; last_name: string } | null;
};

function formatStatus(s: string) {
  return s.replace(/_/g, " ");
}

export default function AdminFamilyPortalPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [triage, setTriage] = useState<TriageRow[]>([]);
  const [conferences, setConferences] = useState<ConferenceRow[]>([]);
  const [consents, setConsents] = useState<ConsentRow[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setTriage([]);
      setConferences([]);
      setConsents([]);
      setLoading(false);
      return;
    }

    try {
      const [tRes, cRes, nRes] = await Promise.all([
        supabase
          .from("family_message_triage_items")
          .select(
            "id, triage_status, matched_keywords, reviewed_at, updated_at, family_portal_messages(body), residents(first_name, last_name)",
          )
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("updated_at", { ascending: false })
          .limit(25),
        supabase
          .from("family_care_conference_sessions")
          .select("id, status, scheduled_start, scheduled_end, recording_consent, external_room_id, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("scheduled_start", { ascending: false })
          .limit(25),
        supabase
          .from("family_consent_records")
          .select("id, consent_type, document_version, signed_at, family_user_id, residents(first_name, last_name)")
          .eq("facility_id", selectedFacilityId)
          .is("deleted_at", null)
          .order("signed_at", { ascending: false })
          .limit(25),
      ]);

      if (tRes.error) throw tRes.error;
      if (cRes.error) throw cRes.error;
      if (nRes.error) throw nRes.error;

      setTriage((tRes.data ?? []) as TriageRow[]);
      setConferences((cRes.data ?? []) as ConferenceRow[]);
      setConsents((nRes.data ?? []) as ConsentRow[]);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load family portal data.");
      setTriage([]);
      setConferences([]);
      setConsents([]);
    } finally {
      setLoading(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  const facilityReady = Boolean(selectedFacilityId && isValidFacilityIdForQuery(selectedFacilityId));

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-white">
            Family portal
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            Triage, care conferences, and consent records for the selected facility.
          </p>
        </div>
        <Link
          href="/admin/family-messages"
          className={cn(buttonVariants({ variant: "outline" }), "inline-flex items-center gap-2 self-start")}
        >
          <MessageCircle className="h-4 w-4" aria-hidden />
          Family messages
        </Link>
      </div>

      {!facilityReady && (
        <p className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Select a facility to load triage, conferences, and consents.
        </p>
      )}

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-100">
          {loadError}
        </p>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Heart className="h-5 w-5 text-rose-600" aria-hidden />
            Message triage
          </CardTitle>
          <CardDescription>
            Clinical review queue for family portal messages. Keyword matches are populated by workflow logic (see spec 21).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : triage.length === 0 ? (
            <p className="text-sm text-slate-500">No triage items for this facility.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Keywords</TableHead>
                  <TableHead>Message</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {triage.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.residents
                        ? `${row.residents.first_name} ${row.residents.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(row.triage_status)}</TableCell>
                    <TableCell className="max-w-[140px] truncate text-xs">
                      {(row.matched_keywords?.length ?? 0) > 0 ? row.matched_keywords.join(", ") : "—"}
                    </TableCell>
                    <TableCell className="max-w-md truncate text-sm text-slate-600 dark:text-slate-300">
                      {row.family_portal_messages?.body ?? "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-xs text-slate-500">
                      {format(new Date(row.updated_at), "MMM d, yyyy p")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Care conferences</CardTitle>
          <CardDescription>Scheduled sessions; recording consent and external room IDs for vendor integrations.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : conferences.length === 0 ? (
            <p className="text-sm text-slate-500">No scheduled conferences for this facility.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead>Start</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Recording OK</TableHead>
                  <TableHead>Room</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {conferences.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.residents
                        ? `${row.residents.first_name} ${row.residents.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(row.scheduled_start), "MMM d, yyyy p")}
                    </TableCell>
                    <TableCell className="capitalize">{formatStatus(row.status)}</TableCell>
                    <TableCell>{row.recording_consent ? "Yes" : "No"}</TableCell>
                    <TableCell className="max-w-[120px] truncate text-xs">{row.external_room_id ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Consent records</CardTitle>
          <CardDescription>Family attestations (type, version, signed time) for the selected facility.</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-slate-500">Loading…</p>
          ) : consents.length === 0 ? (
            <p className="text-sm text-slate-500">No consent records for this facility.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Resident</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Version</TableHead>
                  <TableHead>Signed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {consents.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      {row.residents
                        ? `${row.residents.first_name} ${row.residents.last_name}`
                        : "—"}
                    </TableCell>
                    <TableCell>{row.consent_type}</TableCell>
                    <TableCell className="text-slate-600 dark:text-slate-300">{row.document_version}</TableCell>
                    <TableCell className="whitespace-nowrap text-sm">
                      {format(new Date(row.signed_at), "MMM d, yyyy p")}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
