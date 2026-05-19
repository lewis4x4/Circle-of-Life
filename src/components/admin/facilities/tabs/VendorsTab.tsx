"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowUpRight, ChevronRight, Filter, Loader2, MoreHorizontal, Search, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { PhoneDialLink } from "@/components/primitives/phone-display";
import type { EmergencyContactRow } from "@/hooks/useFacilityEmergencyContacts";
import type { VendorFacilityRow } from "@/hooks/useFacilityVendors";
import type { FlVendorRequirement } from "@/lib/vendors/vendor-fl-requirements";
import {
  evaluateFlVendorRequirement,
  FL_VENDOR_SURVEY_CHECKLIST,
  vendorCategorySetFromLinkedVendors,
} from "@/lib/vendors/vendor-fl-requirements";
import {
  coiTone,
  effectiveVendorCategoryKey,
  formatVendorCategoryLabel,
  vendorContractUiLabel,
  VendorCategoryBadge,
  vendorStatusUiLabel,
} from "@/lib/vendors/vendor-category-ui";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Props = {
  facilityId: string;
  facilityName: string;
  vendors: {
    rows: VendorFacilityRow[];
    kpi: { canonical_vendor_count: number; migration_residue_count: number } | null;
    isLoading: boolean;
    error: string | null;
    refetch: () => void;
  };
  buildingProfile: Record<string, unknown> | null;
  emergencyContacts: EmergencyContactRow[];
};

type CatalogVendor = {
  id: string;
  name: string;
  category: string;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
};

function isResidueRow(row: VendorFacilityRow): boolean {
  return String(row.id).startsWith("facility-launch-");
}

function residuePhoneCount(row: VendorFacilityRow): number {
  const notes = row.vendor?.notes ?? "";
  const m = notes.match(/(\d+)\s+phone\s+entr/i);
  if (m) return Math.max(1, Number(m[1]));
  const m2 = notes.match(/(\d+)\s+phone/i);
  if (m2) return Math.max(1, Number(m2[1]));
  if (/maintenance contact list/i.test(row.vendor?.name ?? "")) return 25;
  return 12;
}

function parseResiduePhones(primary: string | null | undefined): string[] {
  if (!primary) return [];
  const parts = primary
    .split(/[;,/|]/g)
    .map((p) => p.trim())
    .filter(Boolean);
  const digitish = parts.filter((p) => /\d{3}/.test(p));
  return digitish.length ? digitish.slice(0, 25) : [primary];
}

function partnerRow(row: VendorFacilityRow): boolean {
  const cat = effectiveVendorCategoryKey(row.vendor?.category, row.vendor?.name);
  return cat === "government_partner" || cat === "community_partner";
}

function findCanonicalVendorLinked(
  req: FlVendorRequirement,
  rows: readonly VendorFacilityRow[],
): { name: string; id: string } | null {
  const cats = new Set((req.satisfiesCategories ?? []).map((c) => c.trim().toLowerCase()));
  if (!cats.size) return null;
  for (const r of rows) {
    if (isResidueRow(r)) continue;
    const raw = (r.vendor?.category ?? "").trim().toLowerCase();
    const eff = effectiveVendorCategoryKey(r.vendor?.category, r.vendor?.name).toLowerCase();
    if (![...cats].some((c) => c === raw || c === eff)) continue;
    const id = r.vendor?.id ?? "";
    const name = r.vendor?.name ?? "";
    if (!name || !id) continue;
    return { name, id };
  }
  return null;
}

export function VendorsTab(props: Props) {
  const router = useRouter();
  const { facilityId, facilityName, vendors, buildingProfile, emergencyContacts } = props;
  const { rows, isLoading, error, refetch } = vendors;

  const [search, setSearch] = useState("");
  const [catFilter, setCatFilter] = useState<string>("all");
  const [coiFilter, setCoiFilter] = useState<string>("all");
  const [linkOpen, setLinkOpen] = useState(false);
  const [catalogQ, setCatalogQ] = useState("");
  const [catalogRows, setCatalogRows] = useState<CatalogVendor[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [residueOpen, setResidueOpen] = useState<VendorFacilityRow | null>(null);

  const canonicalRows = useMemo(() => rows.filter((r) => !isResidueRow(r)), [rows]);
  const linkedCategories = useMemo(() => vendorCategorySetFromLinkedVendors(canonicalRows), [canonicalRows]);
  const partnerRows = useMemo(() => canonicalRows.filter((r) => partnerRow(r)), [canonicalRows]);

  const suppressRedundantVendorMeta = useMemo(() => {
    if (canonicalRows.length === 0) return false;
    const anchor = effectiveVendorCategoryKey(canonicalRows[0]?.vendor?.category, canonicalRows[0]?.vendor?.name);
    const allSameCat = canonicalRows.every(
      (r) => effectiveVendorCategoryKey(r.vendor?.category, r.vendor?.name) === anchor,
    );
    const allActive = canonicalRows.every((r) => String(r.vendor?.status ?? "").toLowerCase() === "active");
    return allSameCat && allActive;
  }, [canonicalRows]);

  const checklistContext = useMemo(
    () => ({
      linkedCategories,
      vendorRowsCanonical: canonicalRows,
      buildingProfile,
      emergencyContacts,
    }),
    [linkedCategories, canonicalRows, buildingProfile, emergencyContacts],
  );

  const rowPassesFilters = useCallback(
    (row: VendorFacilityRow) => {
      const qDigits = search.replace(/\D/g, "");
      const qLower = search.trim().toLowerCase();
      const name = (row.vendor?.name ?? "").toLowerCase();
      const phone = row.vendor?.primary_contact_phone ?? "";
      const contact = (row.vendor?.primary_contact_name ?? "").toLowerCase();
      if (qLower) {
        const phoneDigits = phone.replace(/\D/g, "");
        const hit =
          name.includes(qLower) ||
          contact.includes(qLower) ||
          phone.includes(search.trim()) ||
          (qDigits.length >= 3 && phoneDigits.includes(qDigits));
        if (!hit) return false;
      }

      const eff = effectiveVendorCategoryKey(row.vendor?.category, row.vendor?.name);
      if (catFilter !== "all" && eff !== catFilter) return false;

      const residue = isResidueRow(row);
      if (!residue) {
        const applies = eff !== "government_partner" && eff !== "community_partner";
        const tone = coiTone({
          applies,
          onFile: row.coi_on_file,
          expiresOn: row.coi_expiration,
        }).tone;
        if (coiFilter === "current" && tone !== "ok" && tone !== "na") return false;
        if (coiFilter === "warn" && tone !== "warn") return false;
        if (coiFilter === "expired" && tone !== "expired") return false;
        if (coiFilter === "na" && tone !== "na") return false;
      } else if (coiFilter !== "all") {
        return false;
      }
      return true;
    },
    [search, catFilter, coiFilter],
  );

  const filteredMain = useMemo(() => rows.filter((r) => rowPassesFilters(r) && !partnerRow(r)), [rows, rowPassesFilters]);

  const filteredPartners = useMemo(
    () => partnerRows.filter((r) => rowPassesFilters(r)),
    [partnerRows, rowPassesFilters],
  );

  const loadCatalog = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const u = new URL(`/api/admin/facilities/${facilityId}/vendors`, window.location.origin);
      u.searchParams.set("mode", "catalog");
      if (catalogQ.trim()) u.searchParams.set("q", catalogQ.trim());
      const res = await fetch(u.toString());
      if (!res.ok) throw new Error("Catalog search failed");
      const j = (await res.json()) as { catalog: CatalogVendor[] };
      setCatalogRows(j.catalog ?? []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Catalog search failed");
      setCatalogRows([]);
    } finally {
      setCatalogLoading(false);
    }
  }, [catalogQ, facilityId]);

  useEffect(() => {
    if (!linkOpen) return;
    const t = window.setTimeout(() => {
      void loadCatalog();
    }, 250);
    return () => window.clearTimeout(t);
  }, [linkOpen, loadCatalog]);

  async function linkVendor(vendorId: string) {
    try {
      const res = await fetch(`/api/admin/facilities/${facilityId}/vendors`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vendor_id: vendorId }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error ?? "Link failed");
      }
      toast.success("Vendor linked to facility");
      setLinkOpen(false);
      refetch();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Link failed");
    }
  }

  function rowHref(row: VendorFacilityRow): string | null {
    const id = row.vendor?.id ?? "";
    if (!id.trim()) return null;
    return `/admin/vendors/${id}`;
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return <p className="text-destructive text-sm">{error}</p>;
  }

  const showNoVendorRows = filteredMain.length === 0 && filteredPartners.length === 0;

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Vendors providing services at this facility. Add or unlink here; manage company-wide records, contracts, COIs, and AP in{" "}
        <Link href="/admin/vendors" className="text-foreground underline-offset-4 hover:underline">
          Vendors &amp; AP
        </Link>
        .
      </p>

      <RequiredCategoriesPanel facilityId={facilityId} checklistContext={checklistContext} canonicalRows={canonicalRows} />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-center">
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search vendors, contacts, or phone"
              className="pl-9 h-10 rounded-md text-sm"
              aria-label="Search vendors"
            />
          </div>
          <Select value={catFilter} onValueChange={setCatFilter}>
            <SelectTrigger className="h-10 w-full sm:w-[200px]" aria-label="Filter by vendor category">
              <Filter className="mr-1 size-4 text-muted-foreground" aria-hidden />
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {[...linkedCategories.values()]
                .filter(Boolean)
                .sort()
                .map((c) => (
                  <SelectItem key={c} value={c}>
                    {formatVendorCategoryLabel(c)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
          <Select value={coiFilter} onValueChange={setCoiFilter}>
            <SelectTrigger className="h-10 w-full sm:w-[200px]" aria-label="Filter by COI status">
              <SelectValue placeholder="COI posture" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All COI states</SelectItem>
              <SelectItem value="current">✓ Healthy (&gt;60d)</SelectItem>
              <SelectItem value="warn">&lt;60d window</SelectItem>
              <SelectItem value="expired">Expired</SelectItem>
              <SelectItem value="na">N/A</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <Button type="button" variant="outline" className="h-10 rounded-md whitespace-nowrap" onClick={() => setLinkOpen(true)}>
          + Link vendor
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="space-y-2 text-left">
          <p className="text-sm text-muted-foreground">
            No vendors linked to <span className="font-medium text-foreground">{facilityName}</span> yet.
          </p>
          <button
            type="button"
            onClick={() => setLinkOpen(true)}
            className={cn(buttonVariants({ variant: "outline", size: "sm", className: "rounded-md" }))}
          >
            Link your first vendor →
          </button>
        </div>
      ) : null}

      {rows.length > 0 && showNoVendorRows ? (
        <p className="text-sm text-muted-foreground">No vendors match these filters.</p>
      ) : null}

      {filteredMain.length > 0 ? (
        <div className="overflow-hidden rounded-[8px] border border-border">
          <table className="w-full caption-bottom border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/40 text-[12px] text-muted-foreground">
                <th className="h-11 px-3 text-left font-medium">Vendor</th>
                <th className="h-11 px-2 text-left font-medium">Category</th>
                <th className="h-11 px-2 text-left font-medium">Primary contact</th>
                <th className="h-11 px-2 text-left font-medium">COI</th>
                <th className="h-11 px-2 text-left font-medium">Contract</th>
                <th className="h-11 px-2 text-right font-medium">Activity</th>
                <th className="h-11 w-14 px-1 text-right font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {filteredMain.map((row) =>
                isResidueRow(row) ? (
                  <ResidueVendorRow key={row.id} row={row} onCleanup={() => setResidueOpen(row)} />
                ) : (
                  <PaidVendorRow
                    key={row.id}
                    row={row}
                    hideMeta={suppressRedundantVendorMeta}
                    href={rowHref(row)}
                    router={router}
                  />
                ),
              )}
            </tbody>
          </table>
        </div>
      ) : null}

      {filteredPartners.length ? (
        <section className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Partners (not paid vendors)</h3>
          <p className="text-xs text-muted-foreground">
            Government/community partners remain visible for surveys but are segmented from paid vendor workflows.
          </p>
          <div className="overflow-hidden rounded-[8px] border border-border border-dashed">
            <table className="w-full border-collapse text-sm">
              <tbody>
                {filteredPartners.map((row) => (
                  <PaidVendorRow
                    key={row.id}
                    row={row}
                    hideMeta={suppressRedundantVendorMeta}
                    href={rowHref(row)}
                    router={router}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-muted-foreground">
            Lafayette county emergency directory also lives under{" "}
            <Link
              href={`/admin/facilities/${facilityId}?tab=emergency`}
              className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
            >
              Emergency contacts <ArrowUpRight className="size-3.5 shrink-0" aria-hidden />
            </Link>
            .
          </p>
        </section>
      ) : null}

      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-lg rounded-[10px]">
          <DialogHeader>
            <DialogTitle className="text-base">Link vendor to {facilityName}</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Search org vendors that are not already linked to this facility.
            </DialogDescription>
          </DialogHeader>
          <Input
            value={catalogQ}
            onChange={(e) => setCatalogQ(e.target.value)}
            placeholder="Search directory"
            aria-label="Search vendor directory"
            className="h-10 rounded-md"
          />
          <div className="max-h-[320px] space-y-1 overflow-auto rounded-md border border-border bg-card p-1">
            {catalogLoading ? (
              <div className="flex justify-center py-8 text-muted-foreground text-sm">
                <Loader2 className="mr-2 size-4 animate-spin" />
                Searching directory…
              </div>
            ) : catalogRows.length === 0 ? (
              <p className="px-3 py-6 text-sm text-muted-foreground">No vendors found.</p>
            ) : (
              catalogRows.map((v) => (
                <div key={v.id} className="flex items-start justify-between gap-2 rounded-md px-3 py-2 hover:bg-muted/60">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{v.name}</p>
                    <p className="text-[12px] text-muted-foreground">{formatVendorCategoryLabel(v.category)}</p>
                  </div>
                  <Button type="button" size="sm" variant="secondary" className="rounded-md" onClick={() => void linkVendor(v.id)}>
                    Link here
                  </Button>
                </div>
              ))
            )}
          </div>
          <DialogFooter className="sm:justify-between">
            <Link
              href="/admin/vendors/new"
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "ghost", size: "sm", className: "rounded-md" })}
            >
              Create new vendor ↗
            </Link>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <CleanupSheet residue={residueOpen} onClose={() => setResidueOpen(null)} />
    </div>
  );
}

function RequiredCategoriesPanel(props: {
  facilityId: string;
  checklistContext: {
    linkedCategories: ReadonlySet<string>;
    vendorRowsCanonical: VendorFacilityRow[];
    buildingProfile: Record<string, unknown> | null;
    emergencyContacts: EmergencyContactRow[];
  };
  canonicalRows: VendorFacilityRow[];
}) {
  const { facilityId, checklistContext, canonicalRows } = props;
  return (
    <section
      id="facility-required-vendor-categories"
      className="rounded-[8px] border border-border bg-card p-4 shadow-[var(--shadow-card)]"
    >
      <h2 className="text-base font-semibold text-foreground">Required vendor categories</h2>
      <p className="mt-1 text-sm text-muted-foreground">Required for FL ALF operations — surveyor-visible checklist.</p>
      <ul className="mt-4 space-y-3">
        {FL_VENDOR_SURVEY_CHECKLIST.map((req) => {
          const ev = evaluateFlVendorRequirement(req, checklistContext);
          const fillVendor = ev.satisfied && ev.via === "vendor_category" ? findCanonicalVendorLinked(req, canonicalRows) : null;
          const optionalBadge = req.optional ? (
            <Badge variant="outline" className="ml-2 text-[10px] font-medium">
              Optional posture
            </Badge>
          ) : null;

          const crossEmergency =
            Boolean(req.emergencyContactCategories?.length) || req.id === "fire_alarm_monitoring" ? (
              <Link
                href={`/admin/facilities/${facilityId}?tab=emergency`}
                className="inline-flex items-center gap-1 text-[12px] font-medium text-primary underline-offset-4 hover:underline"
              >
                Emergency directory ↗
              </Link>
            ) : null;
          const crossBuilding = req.buildingProfileVendorField ? (
            <Link
              href={`/admin/facilities/${facilityId}?tab=building`}
              className="inline-flex items-center gap-1 text-[12px] font-medium text-primary underline-offset-4 hover:underline"
            >
              Building &amp; Safety ↗
            </Link>
          ) : null;

          return (
            <li key={req.id} className="flex flex-col gap-1 border-b border-border/70 pb-3 last:border-0 md:flex-row md:items-start md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {req.label}
                  {optionalBadge}
                </p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted-foreground">
                  {crossBuilding}
                  {crossEmergency}
                </div>
              </div>
              <div className="shrink-0 text-[13px] md:text-right">
                {ev.satisfied ? (
                  <div className="space-y-1 text-emerald-700 dark:text-emerald-300">
                    <span>✓ Filled</span>
                    <div className="text-[12px]">
                      {ev.via === "vendor_category" && fillVendor ? (
                        <Link href={`/admin/vendors/${fillVendor.id}`} className="font-medium underline-offset-4 hover:underline">
                          {fillVendor.name} · View
                        </Link>
                      ) : null}
                      {ev.via === "building_profile" && ev.detail ? (
                        <span className="text-muted-foreground">Profile: {ev.detail}</span>
                      ) : null}
                      {ev.via === "emergency_contact" ? (
                        <Link
                          href={`/admin/facilities/${facilityId}?tab=emergency`}
                          className="inline-flex items-center gap-1 font-medium text-primary underline-offset-4 hover:underline"
                        >
                          Emergency directory · View ↗
                        </Link>
                      ) : null}
                      {ev.via === "name_heuristic" && ev.detail ? (
                        <span className="text-muted-foreground">Recognized supplier: {ev.detail}</span>
                      ) : null}
                    </div>
                  </div>
                ) : req.optional ? (
                  <span className="text-muted-foreground">Survey guidance — verify policy &amp; census posture</span>
                ) : (
                  <>
                    <span className="text-warning">⚠ Required · not linked</span>
                    <div className="mt-2">
                      <Link href="/admin/vendors/new" className={cn(buttonVariants({ variant: "outline", size: "sm", className: "rounded-md" }))}>
                        Add →
                      </Link>
                    </div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function ResidueVendorRow({ row, onCleanup }: { row: VendorFacilityRow; onCleanup: () => void }) {
  const n = residuePhoneCount(row);
  return (
    <tr className="bg-amber-50/70 dark:bg-amber-950/15">
      <td className="h-12 px-3 align-middle" colSpan={7}>
        <div className="flex flex-wrap items-center justify-between gap-2 py-3">
          <div>
            <p className="text-[14px] font-semibold text-foreground">{row.vendor?.name ?? "Imported contact row"}</p>
            <p className="text-[13px] text-amber-800 dark:text-amber-200">
              ⚠ Imported entries need review · {n} phone {n === 1 ? "entry" : "entries"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" variant="outline" className="rounded-md" onClick={onCleanup}>
              Review →
            </Button>
            <Link
              href={`/admin/data-cleanup/migration-residue/${encodeURIComponent(row.id)}`}
              className={buttonVariants({ variant: "outline", size: "sm", className: "rounded-md" })}
            >
              Open review ↗
            </Link>
          </div>
        </div>
      </td>
    </tr>
  );
}

function PaidVendorRow(props: {
  row: VendorFacilityRow;
  href: string | null;
  hideMeta: boolean;
  router: ReturnType<typeof useRouter>;
}) {
  const { row, href, hideMeta } = props;
  const vendor = row.vendor;
  const eff = effectiveVendorCategoryKey(vendor?.category, vendor?.name);
  const coiLabel = coiTone({
    applies: eff !== "government_partner" && eff !== "community_partner",
    onFile: row.coi_on_file,
    expiresOn: row.coi_expiration,
  });
  const contractLabelRaw = vendorContractUiLabel(row.service_contract_status);
  const stat = String(vendor?.status ?? "").toLowerCase();
  const showSubline = !hideMeta && (stat !== "active" || effectiveVendorCategoryKey(vendor?.category, vendor?.name) === "other");

  function openRow() {
    if (href) props.router.push(href);
  }

  const expTitle =
    row.service_contract_expiration && contractLabelRaw === "Active"
      ? `Contract expires ${row.service_contract_expiration}`
      : row.service_contract_expiration
        ? `Expiration ${row.service_contract_expiration}`
        : undefined;

  return (
    <tr
      className={cn(
        "group relative h-[50px] border-b border-border last:border-b-0",
        href ? "cursor-pointer hover:bg-muted/50" : "",
      )}
      onClick={() => href && openRow()}
    >
      <td className="px-3 align-middle">
        <div className="flex items-center gap-2">
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-foreground leading-tight">{vendor?.name ?? "Vendor"}</p>
            {showSubline ? (
              <p className="flex flex-wrap items-center gap-x-1 text-[11px] text-muted-foreground">
                {effectiveVendorCategoryKey(vendor?.category, vendor?.name) === "other" ? (
                  <VendorCategoryBadge category={vendor?.category ?? "other"} vendorName={vendor?.name ?? ""} />
                ) : null}
                {stat !== "active" ? (
                  <>
                    {effectiveVendorCategoryKey(vendor?.category, vendor?.name) === "other" ? <span aria-hidden>·</span> : null}
                    <span>{vendorStatusUiLabel(vendor?.status)}</span>
                  </>
                ) : null}
              </p>
            ) : null}
          </div>
          {href ? (
            <ChevronRight className="size-5 shrink-0 text-muted-foreground opacity-70 transition-opacity group-hover:opacity-100" aria-hidden />
          ) : null}
        </div>
      </td>
      <td className="align-middle px-2 text-[13px] text-muted-foreground">
        <VendorCategoryBadge category={vendor?.category ?? "other"} vendorName={vendor?.name ?? ""} />
      </td>
      <td className="align-middle px-2 text-[12px]">
        <div className="flex flex-col gap-1">
          {vendor?.primary_contact_name ? (
            <span className="font-medium text-foreground">{vendor.primary_contact_name}</span>
          ) : null}
          {vendor?.primary_contact_phone ? (
            <PhoneDialLink phone={vendor.primary_contact_phone} className="text-[12px]" />
          ) : (
            <span className="text-muted-foreground">—</span>
          )}
        </div>
      </td>
      <td
        className={cn(
          "align-middle px-2 text-[12px] font-medium",
          coiLabel.tone === "expired" && "text-destructive",
          coiLabel.tone === "warn" && "text-amber-700 dark:text-amber-300",
          coiLabel.tone === "ok" && "text-emerald-700 dark:text-emerald-300",
          coiLabel.tone === "na" && "text-muted-foreground",
        )}
      >
        {coiLabel.label}
      </td>
      <td className="align-middle px-2 text-[12px] text-foreground">
        <span
          title={expTitle}
          className={cn(
            contractLabelRaw === "No contract" && "text-amber-700 dark:text-amber-300",
            contractLabelRaw === "Expired" && "text-destructive",
          )}
        >
          {contractLabelRaw}
        </span>
      </td>
      <td className="align-middle px-2 text-right text-[12px] text-muted-foreground">
        {row.last_invoice_at ?? row.last_payment_at
          ? new Date((row.last_invoice_at ?? row.last_payment_at)!)
              .toLocaleDateString(undefined, {
                dateStyle: "medium",
              })
          : "—"}
      </td>
      <td className="align-middle px-1 text-right" onClick={(e) => e.stopPropagation()}>
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className="inline-flex size-8 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-muted"
            aria-label="Vendor row actions"
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 text-sm">
            {href ? (
              <DropdownMenuItem
                onSelect={() => {
                  void props.router.push(href);
                }}
              >
                View vendor
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuItem disabled>Update COI</DropdownMenuItem>
            <DropdownMenuItem disabled>Update contract</DropdownMenuItem>
            <DropdownMenuItem disabled>Unlink from facility</DropdownMenuItem>
            <DropdownMenuItem disabled>Mark inactive</DropdownMenuItem>
            <DropdownMenuItem disabled>View activity</DropdownMenuItem>
            <DropdownMenuItem disabled>View contract</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
}

function CleanupSheet(props: { residue: VendorFacilityRow | null; onClose: () => void }) {
  const { residue, onClose } = props;
  if (!residue) return null;
  const phones = parseResiduePhones(residue.vendor?.primary_contact_phone);
  return (
    <Sheet open onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-[min(100vw,420px)] p-0">
        <SheetHeader className="border-b border-border px-4 py-3 text-left">
          <SheetTitle className="text-base">Review imported contacts</SheetTitle>
          <SheetDescription className="text-sm text-muted-foreground">
            {residue.vendor?.name ?? "Imported directory"} — move phones into governed vendor or emergency records.
          </SheetDescription>
        </SheetHeader>
        <div className="max-h-[70vh] space-y-2 overflow-auto px-4 py-4">
          {phones.map((p, idx) => (
            <div
              key={`${p}-${idx}`}
              className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2 text-sm"
            >
              <span className="tabular-nums text-foreground">{p}</span>
              <div className="flex flex-wrap gap-1">
                <Button type="button" size="sm" variant="outline" className="rounded-md" disabled>
                  Promote
                </Button>
                <Button type="button" size="sm" variant="outline" className="rounded-md" disabled>
                  Move ↗
                </Button>
                <Button type="button" size="sm" variant="ghost" className="rounded-md" disabled>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border px-4 py-3 text-[12px] text-muted-foreground">
          Contact review tracked with{" "}
          <Link
            href={`/admin/data-cleanup/migration-residue/${encodeURIComponent(residue.id)}`}
            className="text-primary underline-offset-4 hover:underline"
          >
            import review queue
          </Link>
          .
        </div>
      </SheetContent>
    </Sheet>
  );
}
