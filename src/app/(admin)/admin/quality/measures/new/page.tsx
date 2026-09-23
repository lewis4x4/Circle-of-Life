"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2 } from "lucide-react";

import { QualityHubNav } from "../../quality-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export default function AdminQualityMeasureNewPage() {
  const router = useRouter();
  const supabase = createClient();
  // The measure catalog is organization-wide (COL-651): it never needed a
  // facility, only the organization the header's facility used to resolve.
  const { user, organizationId, loading: authLoading } = useHavenAuth();

  const [measureKey, setMeasureKey] = useState("");
  const [name, setName] = useState("");
  const [domain, setDomain] = useState("");
  const [unit, setUnit] = useState("");
  const [cmsTag, setCmsTag] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!organizationId) {
      setError("Your profile has no organization, so a catalog measure cannot be saved.");
      return;
    }
    const mk = measureKey.trim();
    const nm = name.trim();
    if (!mk || !nm) {
      setError("Measure key and name are required.");
      return;
    }

    setSubmitting(true);
    try {
      if (!user?.id) {
        setError("You must be signed in.");
        return;
      }

      const { data: inserted, error: insErr } = await supabase
        .from("quality_measures")
        .insert({
          organization_id: organizationId,
          measure_key: mk,
          name: nm,
          description: description.trim() || null,
          domain: domain.trim() || null,
          unit: unit.trim() || null,
          cms_tag: cmsTag.trim() || null,
          is_active: true,
          created_by: user.id,
        })
        .select("id")
        .single();

      if (insErr) {
        setError(insErr.message);
        return;
      }
      if (inserted?.id) {
        router.push("/admin/quality");
        router.refresh();
      }
    } finally {
      setSubmitting(false);
    }
  }

  const noOrganization = !authLoading && !organizationId;

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-100">
            Define measure
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
            Catalog entries require <strong className="font-medium">owner</strong> or <strong className="font-medium">org admin</strong>{" "}
            (RLS).
          </p>
        </div>
        <Link href="/admin/quality" className={cn(buttonVariants({ variant: "outline", size: "sm" }))}>
          Back to overview
        </Link>
      </div>

      <QualityHubNav />

      <Card className="border-slate-200/80 shadow-soft dark:border-slate-800">
        <CardHeader>
          <CardTitle className="text-lg">Measure</CardTitle>
        </CardHeader>
        <CardContent>
          {noOrganization ? (
            <p className="text-sm text-muted-foreground">Your profile has no organization, so catalog measures cannot be defined here.</p>
          ) : (
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="qm-key">Measure key</Label>
                <Input
                  id="qm-key"
                  value={measureKey}
                  onChange={(e) => setMeasureKey(e.target.value)}
                  placeholder="e.g. falls_injury_rate"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qm-name">Name</Label>
                <Input id="qm-name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="qm-domain">Domain</Label>
                  <Input id="qm-domain" value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="clinical, safety…" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="qm-unit">Unit</Label>
                  <Input id="qm-unit" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="percent, count…" />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="qm-cms">CMS tag (optional)</Label>
                <Input id="qm-cms" value={cmsTag} onChange={(e) => setCmsTag(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="qm-desc">Description</Label>
                <Input id="qm-desc" value={description} onChange={(e) => setDescription(e.target.value)} />
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
                  "Save measure"
                )}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
