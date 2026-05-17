"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Check, Link2, Globe, Building2, User, HelpCircle, Server } from "lucide-react";
import { MotionList, MotionItem } from "@/components/ui/motion-list";
import { Badge } from "@/components/ui/badge";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const SOURCE_TYPES = [
  { value: "hospital", label: "Hospital" },
  { value: "agency", label: "Agency" },
  { value: "family", label: "Family" },
  { value: "web", label: "Web" },
  { value: "other", label: "Other" },
] as const;

type SourceRow = {
  id: string;
  name: string;
  source_type: string;
  facility_id: string | null;
  is_active: boolean;
};

export default function AdminReferralSourcesPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [sourceType, setSourceType] = useState<string>("hospital");
  const [scopeFacility, setScopeFacility] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setRows([]);
      setLoading(false);
      return;
    }

    const { data: fac, error: facErr } = await supabase.from("facilities").select("organization_id").eq("id", selectedFacilityId).single();
    if (facErr || !fac?.organization_id) {
      setLoadError("Could not resolve organization for this facility.");
      setRows([]);
      setLoading(false);
      return;
    }

    const { data, error: qErr } = await supabase
      .from("referral_sources")
      .select("id, name, source_type, facility_id, is_active")
      .eq("organization_id", fac.organization_id)
      .is("deleted_at", null)
      .or(`facility_id.is.null,facility_id.eq.${selectedFacilityId}`)
      .order("name");

    if (qErr) {
      setLoadError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as SourceRow[]);
    }
    setLoading(false);
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setFormError("Select a facility in the header.");
      return;
    }
    const n = name.trim();
    if (!n) {
      setFormError("Name is required.");
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
        setFormError("Could not resolve organization for this facility.");
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user?.id) {
        setFormError("You must be signed in.");
        return;
      }

      const payload = {
        organization_id: fac.organization_id,
        facility_id: scopeFacility ? selectedFacilityId : null,
        name: n,
        source_type: sourceType,
        is_active: true,
        created_by: user.id,
      };

      const { error: insErr } = await supabase.from("referral_sources").insert(payload);
      if (insErr) {
        setFormError(insErr.message);
        return;
      }
      setName("");
      setScopeFacility(false);
      await load();
    } finally {
      setSubmitting(false);
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);

  return (
    <div className="space-y-6 pb-12">
      <div className="space-y-6">
        <ReferralsHubNav />
        <header className="mb-8 flex flex-col gap-6 md:flex-row md:items-end justify-between bg-card p-8 rounded-lg border border-border mt-4">
          <div className="space-y-3">
             <h1 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-4">
               Referral Sources
             </h1>
            <p className="mt-2 text-[13px] text-muted-foreground max-w-2xl text-balance">
               Master list for attribution (hospital, agency, family, web, other). Ties to <code className="rounded bg-muted/40 px-1.5 py-0.5 text-[10px] uppercase font-semibold tracking-wider text-muted-foreground">residents.referral_source_id</code> when set.
            </p>
          </div>
          <div>
            <Link
              href="/admin/referrals"
              className={cn(buttonVariants({ variant: "outline", size: "default" }), "h-9 px-4 text-[12px] font-medium flex items-center gap-2")}
            >
              Back to Pipeline
            </Link>
          </div>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
           <div className="lg:col-span-1 rounded-lg border border-border bg-card overflow-hidden p-6 md:p-8 relative h-fit order-last lg:order-first">
             <div className="mb-6 border-b border-border pb-4 flex flex-col gap-1">
                <h3 className="text-xl font-semibold text-foreground flex items-center gap-2">
                  <Plus className="h-5 w-5 text-primary" /> Add Source
                </h3>
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
                   Requires Owner or Org Admin
                </p>
             </div>
             
             {noFacility ? (
               <div className="p-4 rounded-lg bg-warning/10 border border-warning/20 text-[13px] font-medium text-warning">
                 Select a facility in the header to manage sources.
               </div>
             ) : (
               <form onSubmit={(e) => void handleCreate(e)} className="space-y-4">
                 <div className="space-y-4">
                   <div className="space-y-1.5">
                     <Label htmlFor="src-name" className="text-xs uppercase tracking-wider text-muted-foreground">Name</Label>
                     <Input id="src-name" value={name} onChange={(e) => setName(e.target.value)} required className="h-10 rounded-lg" />
                   </div>
                   <div className="space-y-1.5">
                     <Label htmlFor="src-type" className="text-xs uppercase tracking-wider text-muted-foreground">Type</Label>
                     <select
                       id="src-type"
                       value={sourceType}
                       onChange={(e) => setSourceType(e.target.value)}
                       className="flex h-10 w-full rounded-lg border border-border bg-background px-3 py-1 text-sm outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 text-foreground"
                     >
                       {SOURCE_TYPES.map((t) => (
                         <option key={t.value} value={t.value}>
                           {t.label}
                         </option>
                       ))}
                     </select>
                   </div>
                   <label className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card cursor-pointer hover:bg-muted/40 transition-colors duration-[var(--motion-duration-micro)]">
                     <div className="relative flex items-center justify-center">
                       <input
                         type="checkbox"
                         checked={scopeFacility}
                         onChange={(e) => setScopeFacility(e.target.checked)}
                         className="peer h-5 w-5 appearance-none rounded border-2 border-border checked:border-primary checked:bg-primary transition-all cursor-pointer"
                       />
                       <Check className="absolute h-3.5 w-3.5 text-white opacity-0 peer-checked:opacity-100 pointer-events-none" />
                     </div>
                     <span className="text-[13px] font-medium text-foreground">Limit to current facility</span>
                   </label>
                 </div>

                 {formError && (
                   <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-[12px] font-semibold text-destructive" role="alert">
                     {formError}
                   </div>
                 )}
                 <Button type="submit" disabled={submitting} className="w-full h-10 rounded-lg font-semibold tracking-wider uppercase text-[10px] bg-primary hover:bg-primary/90 text-primary-foreground">
                   {submitting ? (
                     <>
                       <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                       Saving…
                     </>
                   ) : (
                     "Add Source"
                   )}
                 </Button>
               </form>
             )}
           </div>

           <div className="lg:col-span-2 rounded-lg border border-border bg-card overflow-hidden p-6 md:p-8 relative">
              <div className="mb-6 border-b border-border pb-4 flex items-center justify-between">
                <h3 className="text-xl font-semibold text-foreground mt-1 flex items-center gap-2">
                   <Link2 className="h-5 w-5 text-primary" /> Configured Sources
                </h3>
                <p className="text-[10px] tracking-wider text-muted-foreground mt-1 uppercase">Org & Facility Scoped</p>
              </div>

              <div className="relative z-10 w-full overflow-hidden">
                {loading ? (
                  <div className="flex items-center justify-center p-12 text-[13px] text-muted-foreground">
                     <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading Sources...
                  </div>
                ) : loadError ? (
                  <div className="p-6 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive font-medium text-[13px]">
                    {loadError}
                  </div>
                ) : (
                  <>
                    <div className="hidden sm:grid grid-cols-[1.5fr_1fr_1fr_0.5fr] gap-4 px-[13px] pb-4 border-b border-border text-left text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                       <div>Name</div>
                       <div>Type</div>
                       <div>Scope</div>
                       <div className="text-right">Active</div>
                    </div>

                    <div className="space-y-3 mt-4">
                       <MotionList className="space-y-3">
                          {rows.length === 0 ? (
                            <div className="p-12 text-center text-muted-foreground text-[13px] bg-muted/40 rounded-lg border border-dashed border-border">
                               No sources yet. Add one or ask an org admin to create channels.
                            </div>
                          ) : (
                             rows.map((r) => {
                                const TypeIcon = r.source_type === "hospital" ? Building2 : r.source_type === "agency" ? Server : r.source_type === "web" ? Globe : r.source_type === "family" ? User : HelpCircle;
                                return (
                                 <MotionItem key={r.id}>
                                    <div className="flex items-center gap-3 min-h-[36px] px-[13px] py-2 rounded-lg border border-border bg-card hover:bg-muted/40 hover:-translate-y-0.5 transition-all duration-[var(--motion-duration-micro)] ease-[var(--motion-ease)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-0 w-full">
                                      <div className="flex-[1.5] flex flex-col">
                                         <span className="font-semibold text-[13px] text-foreground tracking-tight leading-tight">{r.name}</span>
                                      </div>
                                      <div className="flex-1 flex items-center gap-2">
                                         <Badge className="bg-muted/40 hover:bg-muted text-muted-foreground border-none text-[10px] uppercase font-semibold tracking-wider">
                                            <TypeIcon className="w-3 h-3 mr-1.5 opacity-50" />
                                            {r.source_type.replace(/_/g, " ")}
                                         </Badge>
                                      </div>
                                      <div className="flex-1 flex flex-col">
                                         <span className="text-[12px] text-muted-foreground">
                                           {r.facility_id ? "This Facility" : "Organization"}
                                         </span>
                                      </div>
                                      <div className="flex-[0.5] flex flex-col items-end">
                                         {r.is_active ? (
                                            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-success/10 text-success self-start sm:self-auto">
                                              <Check className="h-3.5 w-3.5" />
                                            </span>
                                         ) : (
                                            <span className="inline-flex h-6 px-2.5 items-center justify-center rounded-[4px] bg-muted/40 text-muted-foreground text-[10px] font-semibold uppercase tracking-wider self-start sm:self-auto">
                                              No
                                            </span>
                                         )}
                                      </div>
                                    </div>
                                 </MotionItem>
                                );
                             })
                          )}
                       </MotionList>
                    </div>
                  </>
                )}
              </div>
           </div>
        </div>
      </div>
    </div>
  );
}
