"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Loader2, MoreHorizontal } from "lucide-react";
import { toast } from "sonner";

import { ReferralsHubNav } from "../referrals-hub-nav";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { StatusPill } from "@/components/ui/status-pill";
import { useHavenAuth } from "@/contexts/haven-auth-context";
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

const TYPE_FILTER_OPTS = [{ value: "all", label: "All types" }, ...SOURCE_TYPES.map((t) => ({ value: t.value, label: t.label }))] as const;

const STATUS_FILTER_OPTS = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "inactive", label: "Inactive" },
] as const;

type SourceRow = {
  id: string;
  name: string;
  source_type: string;
  facility_id: string | null;
  is_active: boolean;
};

const labelClass = "text-[13px] font-semibold text-muted-foreground";

function similarityHint(input: string, existing: string[]): string | undefined {
  const n = input.trim().toLowerCase();
  if (n.length < 2) return undefined;
  for (const x of existing) {
    const xl = x.toLowerCase();
    if (!xl.length || xl === n) continue;
    if (xl.includes(n) || n.includes(xl)) return x;
    const dice = xl.split(/\s+/).some((w) => w.length > 3 && (n.includes(w) || xl.includes(w)));
    if (dice) return x;
  }
  return undefined;
}

export default function AdminReferralSourcesPage() {
  const supabase = createClient();
  const { user, appRole, loading: authLoading } = useHavenAuth();
  const { selectedFacilityId, availableFacilities } = useFacilityStore();

  const [rows, setRows] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [organizationId, setOrganizationId] = useState<string | null>(null);
  const roleLoading = authLoading;
  const canAddSource = appRole === "owner" || appRole === "org_admin";
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [nameBlurHint, setNameBlurHint] = useState<{ suggested: string } | null>(null);
  const [sourceType, setSourceType] = useState<string>("hospital");
  const [limitOneFacility, setLimitOneFacility] = useState(false);
  const [targetFacilityId, setTargetFacilityId] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const resolveOrganizationId = useCallback(async (): Promise<string | null> => {
    if (selectedFacilityId != null && isValidFacilityIdForQuery(selectedFacilityId)) {
      const { data } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      return data?.organization_id ?? null;
    }
    if (availableFacilities.length > 0) {
      const first = availableFacilities[0]!.id;
      const { data } = await supabase
        .from("facilities")
        .select("organization_id")
        .eq("id", first)
        .is("deleted_at", null)
        .maybeSingle();
      return data?.organization_id ?? null;
    }
    return null;
  }, [availableFacilities, selectedFacilityId, supabase]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const oid = await resolveOrganizationId();
    setOrganizationId(oid);
    if (!oid) {
      setRows([]);
      setLoading(false);
      setLoadError(availableFacilities.length === 0 ? "No facilities available for this profile." : "Could not resolve organization.");
      return;
    }

    const facIds = availableFacilities.map((f) => f.id).filter((id) => isValidFacilityIdForQuery(id));
    let query = supabase
      .from("referral_sources")
      .select("id, name, source_type, facility_id, is_active")
      .eq("organization_id", oid)
      .is("deleted_at", null)
      .order("name");

    if (selectedFacilityId != null && isValidFacilityIdForQuery(selectedFacilityId)) {
      query = query.or(`facility_id.is.null,facility_id.eq.${selectedFacilityId}`);
    } else if (facIds.length > 0) {
      const orParts = [`facility_id.is.null`, ...facIds.map((id) => `facility_id.eq.${id}`)];
      query = query.or(orParts.join(","));
    }

    const { data, error: qErr } = await query;
    if (qErr) {
      setLoadError(qErr.message);
      setRows([]);
    } else {
      setRows((data ?? []) as SourceRow[]);
    }
    setLoading(false);
  }, [availableFacilities, resolveOrganizationId, selectedFacilityId, supabase]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!highlightId) return;
    const t = window.setTimeout(() => setHighlightId(null), 2200);
    return () => window.clearTimeout(t);
  }, [highlightId]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (q && !r.name.toLowerCase().includes(q)) return false;
      if (typeFilter !== "all" && r.source_type !== typeFilter) return false;
      if (statusFilter === "active" && !r.is_active) return false;
      if (statusFilter === "inactive" && r.is_active) return false;
      return true;
    });
  }, [rows, search, statusFilter, typeFilter]);

  const facilityLabel = useMemo(() => {
    const m = new Map(availableFacilities.map((f) => [f.id, f.name] as const));
    return (id: string | null) => {
      if (id == null) return "Org-wide";
      return m.get(id) ?? "Facility";
    };
  }, [availableFacilities]);

  const accessibleFacilityOptions =
    selectedFacilityId != null && isValidFacilityIdForQuery(selectedFacilityId)
      ? availableFacilities.filter((f) => f.id === selectedFacilityId)
      : availableFacilities;

  useEffect(() => {
    if (!limitOneFacility) return;
    if (targetFacilityId) return;
    if (accessibleFacilityOptions.length === 1) {
      setTargetFacilityId(accessibleFacilityOptions[0]!.id);
    }
  }, [accessibleFacilityOptions, limitOneFacility, targetFacilityId]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const n = name.trim();
    if (!n) return;
    const oid = organizationId ?? (await resolveOrganizationId());
    if (!oid) {
      setFormError("Could not resolve organization.");
      return;
    }

    let facilityScoped: string | null = null;
    if (limitOneFacility) {
      if (!targetFacilityId || !isValidFacilityIdForQuery(targetFacilityId)) {
        setFormError("Select a facility.");
        return;
      }
      facilityScoped = targetFacilityId;
    }

    if (!user?.id) {
      setFormError("You must be signed in.");
      return;
    }

    setSubmitting(true);
    try {
      const payload = {
        organization_id: oid,
        facility_id: facilityScoped,
        name: n,
        source_type: sourceType,
        is_active: true,
        created_by: user.id,
      };

      const { data: inserted, error: insErr } = await supabase
        .from("referral_sources")
        .insert(payload)
        .select("id, name, source_type, facility_id, is_active")
        .maybeSingle();

      if (insErr) {
        setFormError(insErr.message);
        return;
      }

      toast.success("Source added.");
      if (inserted) {
        setRows((prev) => [inserted as SourceRow, ...prev.filter((r) => r.id !== inserted.id)]);
        setHighlightId(inserted.id as string);
      } else {
        await load();
      }
      setName("");
      setNameBlurHint(null);
      setLimitOneFacility(false);
      setTargetFacilityId("");
      setSourceType("hospital");
    } finally {
      setSubmitting(false);
    }
  }

  const disableSubmit =
    submitting || roleLoading || !canAddSource || !name.trim() || (limitOneFacility && (!targetFacilityId || !isValidFacilityIdForQuery(targetFacilityId)));

  const COL_SPAN = 5;

  return (
    <div className="space-y-8 pb-12">
      <div>
        <Link
          href="/admin/referrals"
          className="inline-flex text-[13px] font-medium text-primary underline-offset-4 hover:underline"
        >
          ← Back to pipeline
        </Link>

        <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground">Referral sources</h1>
        <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
          Master list of attribution sources used across the org.
        </p>

        <div className="mt-4">
          <ReferralsHubNav />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 lg:gap-8">
        <section className="h-fit rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-card)] ring-1 ring-border/60 lg:col-span-1">
          <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Add source</h2>

          {roleLoading ? (
            <p className="mt-6 text-[13px] text-muted-foreground">Checking access…</p>
          ) : !canAddSource ? (
            <div className="mt-6 space-y-2 text-left">
              <p className="text-[13px] font-medium text-foreground">You don&apos;t have permission to add sources.</p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">Ask an org admin or owner.</p>
            </div>
          ) : !organizationId && !loading && loadError ? (
            <p className="mt-4 text-[13px] text-muted-foreground">{loadError}</p>
          ) : (
            <form onSubmit={(e) => void handleCreate(e)} className="mt-6 space-y-4">
                  <div className="space-y-1.5">
                    <Label htmlFor="src-name" className={labelClass}>
                      Name <span className="font-semibold text-destructive">*</span>
                    </Label>
                    <Input
                      id="src-name"
                      value={name}
                      maxLength={200}
                      onChange={(e) => {
                        const v = e.target.value;
                        setName(v);
                        if (nameBlurHint) setNameBlurHint(null);
                      }}
                      onBlur={() => {
                        const sug = similarityHint(name, rows.map((r) => r.name));
                        setNameBlurHint(sug ? { suggested: sug } : null);
                      }}
                      className="h-10 text-[13px]"
                      autoComplete="off"
                    />
                    {nameBlurHint ? (
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                        <span>
                          Did you mean &quot;{nameBlurHint.suggested}&quot;?
                          <button
                            type="button"
                            className="ml-2 font-medium text-primary underline underline-offset-2"
                            onClick={() => setName(nameBlurHint.suggested)}
                          >
                            Use existing
                          </button>
                          <button
                            type="button"
                            className="ml-2 font-medium text-primary underline underline-offset-2"
                            onClick={() => setNameBlurHint(null)}
                          >
                            Continue
                          </button>
                        </span>
                      </div>
                    ) : null}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="src-type-trigger" className={labelClass}>
                      Type
                    </Label>
                    <Select value={sourceType} onValueChange={(v) => setSourceType(v)}>
                      <SelectTrigger id="src-type-trigger" className="h-10 w-full text-[13px] shadow-none">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {SOURCE_TYPES.map((t) => (
                          <SelectItem key={t.value} value={t.value} className="text-[13px]">
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  <label className="flex cursor-pointer items-start gap-2 text-[13px] text-foreground">
                    <input
                      type="checkbox"
                      checked={limitOneFacility}
                      onChange={(e) => {
                        setLimitOneFacility(e.target.checked);
                        if (!e.target.checked) setTargetFacilityId("");
                      }}
                      className="mt-0.5 size-4 rounded border border-border accent-primary"
                    />
                    <span>Limit to a single facility</span>
                  </label>

                  {limitOneFacility ? (
                    <div className="space-y-1.5 pl-6">
                      <Label htmlFor="fac-scope" className={labelClass}>
                        Facility
                      </Label>
                      <Select value={targetFacilityId} onValueChange={(v) => setTargetFacilityId(v)}>
                        <SelectTrigger id="fac-scope" className="h-10 w-full text-[13px] shadow-none">
                          <SelectValue placeholder="Select facility" />
                        </SelectTrigger>
                        <SelectContent>
                          {accessibleFacilityOptions.map((f) => (
                            <SelectItem key={f.id} value={f.id} className="text-[13px]">
                              {f.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}

                  {formError ? (
                    <p className="text-[13px] font-medium text-destructive" role="alert">
                      {formError}
                    </p>
                  ) : null}

                  <div className="flex justify-end pt-1">
                    <Button type="submit" disabled={disableSubmit} className="min-w-[140px] font-medium">
                      {submitting ? (
                        <>
                          <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> Saving…
                        </>
                      ) : (
                        "Add source"
                      )}
                    </Button>
                  </div>

                  <p className="text-left text-[12px] leading-relaxed text-muted-foreground">
                    Adding requires owner or org admin role.
                  </p>
                </form>
          )}
        </section>

        <section className="rounded-xl border border-border bg-card p-6 shadow-[var(--shadow-card)] ring-1 ring-border/60 lg:col-span-2">
          <div className="space-y-1 border-b border-border pb-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <h2 className="text-[15px] font-semibold tracking-tight text-foreground">Configured sources</h2>
            </div>
            <p className="max-w-xl text-[12px] text-muted-foreground">Scope: org-level with optional facility limit.</p>
          </div>

          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            <Input
              placeholder="Search by name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-8 flex-1 min-w-[10rem] text-[13px] sm:max-w-xs"
              aria-label="Search sources"
            />
            <div className="flex flex-wrap gap-2">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v)}>
                <SelectTrigger className="h-8 w-[10.5rem] text-[13px] shadow-none" aria-label="Filter by source type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TYPE_FILTER_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[13px]">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v)}>
                <SelectTrigger className="h-8 w-[9rem] text-[13px] shadow-none" aria-label="Status filter">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STATUS_FILTER_OPTS.map((o) => (
                    <SelectItem key={o.value} value={o.value} className="text-[13px]">
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="mt-6">
            {loading ? (
              <div className="flex items-center gap-2 p-8 text-[13px] text-muted-foreground">
                <Loader2 className="size-4 animate-spin" aria-hidden /> Loading sources…
              </div>
            ) : loadError ? (
              <p className="p-6 text-[13px] font-medium text-destructive">{loadError}</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent border-b-0">
                    <TableHead>Name</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Scope</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.length === 0 ? (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={COL_SPAN} className="border-b-0 py-10 text-left text-[13px] text-muted-foreground">
                        No sources yet. Add the first source on the left to start attributing leads.
                      </TableCell>
                    </TableRow>
                  ) : (
                    filteredRows.map((r) => (
                      <TableRow
                        key={r.id}
                        className={cn(
                          highlightId === r.id ? "motion-safe:bg-primary/15 motion-safe:transition-colors motion-safe:duration-[1.75s]" : "",
                        )}
                      >
                        <TableCell className="max-w-[14rem] text-[13px] font-medium text-foreground">{r.name}</TableCell>
                        <TableCell className="capitalize text-[13px] text-muted-foreground">{r.source_type.replace(/_/g, " ")}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{facilityLabel(r.facility_id)}</TableCell>
                        <TableCell>
                          {r.is_active ? <StatusPill tone="muted">Active</StatusPill> : <StatusPill tone="warning">Inactive</StatusPill>}
                        </TableCell>
                        <TableCell className="text-right">
                          <DropdownMenu>
                            <DropdownMenuTrigger
                              type="button"
                              aria-label={`Actions for ${r.name}`}
                              className={cn(
                                buttonVariants({ variant: "ghost", size: "icon" }),
                                "size-8 text-muted-foreground hover:text-foreground",
                              )}
                            >
                              <MoreHorizontal className="size-4" aria-hidden />
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48 text-[13px]">
                              <DropdownMenuItem
                                onClick={() =>
                                  toast.message("Edit source", {
                                    description: "Inline editing will connect when the referrals settings API ships.",
                                  })
                                }
                              >
                                Edit
                              </DropdownMenuItem>
                              {r.is_active ? (
                                <DropdownMenuItem
                                  variant="destructive"
                                  onClick={() =>
                                    toast.message("Deactivate", {
                                      description: "Soft-archive actions will route through retention-safe workflows.",
                                    })
                                  }
                                >
                                  Deactivate
                                </DropdownMenuItem>
                              ) : (
                                <DropdownMenuItem
                                  onClick={() =>
                                    toast.message("Activate", {
                                      description: "Reactive paths stay audit-logged.",
                                    })
                                  }
                                >
                                  Activate
                                </DropdownMenuItem>
                              )}
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                onClick={() =>
                                  toast.message("History preserved", {
                                    description: "Attribution ties stay intact — only operators change visibility.",
                                  })
                                }
                              >
                                Attribution note
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
