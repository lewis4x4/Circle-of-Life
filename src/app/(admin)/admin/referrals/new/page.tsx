"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

export default function AdminReferralsNewPage() {
  const router = useRouter();
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [referralSourceId, setReferralSourceId] = useState<string>("");
  const [sources, setSources] = useState<{ id: string; name: string }[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSources = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setSources([]);
      setLoadingSources(false);
      return;
    }
    setLoadingSources(true);
    const { data: fac } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
    const orgId = fac?.organization_id;
    if (!orgId) {
      setSources([]);
      setLoadingSources(false);
      return;
    }
    const { data, error: qErr } = await supabase
      .from("referral_sources")
      .select("id, name")
      .eq("organization_id", orgId)
      .is("deleted_at", null)
      .eq("is_active", true)
      .or(`facility_id.is.null,facility_id.eq.${selectedFacilityId}`)
      .order("name");
    if (qErr) {
      setSources([]);
    } else {
      setSources((data ?? []) as { id: string; name: string }[]);
    }
    setLoadingSources(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void loadSources();
  }, [loadSources]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setError("Select a facility in the header.");
      return;
    }
    const fn = firstName.trim();
    const ln = lastName.trim();
    if (!fn || !ln) {
      setError("First and last name are required.");
      return;
    }

    setSubmitting(true);
    try {
      const { data: fac, error: facErr } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (facErr || !fac?.organization_id) {
        setError("Could not resolve organization for this facility.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      const payload = {
        organization_id: fac.organization_id,
        facility_id: selectedFacilityId,
        first_name: fn,
        last_name: ln,
        phone: phone.trim() || null,
        email: email.trim() || null,
        referral_source_id: referralSourceId || null,
        status: "new" as const,
        created_by: user.id,
      };

      const { data: inserted, error: insErr } = await supabase.from("referral_leads").insert(payload).select("id").single();
      if (insErr) {
        setError(insErr.message);
        return;
      }
      if (inserted?.id) {
        router.push(`/admin/referrals/${inserted.id}`);
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            New referral lead
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Capture inquiry details before a full resident record exists.
          </p>
        </div>
        <Link href="/admin/referrals" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to pipeline
        </Link>
      </div>

      <ReferralsHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="font-display text-lg">Lead form</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Creates a row in <code className="text-xs">referral_leads</code> for the facility selected in the admin header.
          </p>
        </CardHeader>
        <CardContent>
          {noFacility ? (
            <p className="text-sm text-amber-800 dark:text-amber-200">Select a facility in the header to add a lead.</p>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ref-first">First name</Label>
                  <Input
                    id="ref-first"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    autoComplete="given-name"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ref-last">Last name</Label>
                  <Input
                    id="ref-last"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    autoComplete="family-name"
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="ref-phone">Phone</Label>
                  <Input id="ref-phone" value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" autoComplete="tel" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="ref-email">Email</Label>
                  <Input id="ref-email" value={email} onChange={(e) => setEmail(e.target.value)} type="email" autoComplete="email" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="ref-source">Referral source</Label>
                <select
                  id="ref-source"
                  value={referralSourceId}
                  onChange={(e) => setReferralSourceId(e.target.value)}
                  disabled={loadingSources}
                  className="flex h-8 w-full rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 md:text-sm dark:bg-input/30"
                >
                  <option value="">— None —</option>
                  {sources.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  Add or manage channels on{" "}
                  <Link href="/admin/referrals/sources" className="underline underline-offset-2">
                    Referral sources
                  </Link>
                  .
                </p>
              </div>
              <div className="rounded-lg border border-amber-200/80 bg-amber-50/50 px-4 py-3 text-sm text-amber-950 dark:border-amber-900/50 dark:bg-amber-950/30 dark:text-amber-100">
                <code className="text-xs">pii_access_tier</code> defaults to <code className="text-xs">standard_ops</code>; column-level
                filtering for minimum necessary is enforced in app layers per spec.
              </div>
              {error ? (
                <p className="text-sm text-red-600 dark:text-red-400" role="alert">
                  {error}
                </p>
              ) : null}
              <Button type="submit" disabled={submitting}>
                {submitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save lead"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
