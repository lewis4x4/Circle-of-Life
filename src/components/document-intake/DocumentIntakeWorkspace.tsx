"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Plus } from "lucide-react";

import { AdminEmptyState, AdminErrorState, AdminTableLoadingState } from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { FormLabel } from "@/components/ui/form-label";
import { Input } from "@/components/ui/input";
import { StatusPill } from "@/components/ui/status-pill";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useHavenAuth } from "@/contexts/haven-auth-context";
import { PageHeader } from "@/design-system/components/PageHeader";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { INTAKE_TABS, type CatalogRow, type IntakeTab } from "@/lib/document-intake/contracts";
import { formatFacilityTimestampEt } from "@/lib/facility-wall-clock";
import { cn } from "@/lib/utils";

import {
  countTabs,
  intakeClient,
  listItems,
  loadCatalog,
  loadPeopleNames,
  loadSettings,
  type AgeFilter,
  type AssignedFilter,
  type IntakeSettings,
  type ListedItem,
  type ListFilters,
} from "./data";
import { groupCatalog } from "./destination";
import { FIELD_CLASS } from "./IntakeDialogs";
import {
  ageLabel,
  CHANNEL_LABELS,
  INTAKE_TAB_ORDER,
  isOverdue,
  itemTitle,
  processingLabel,
  processingTone,
  statusLabel,
  statusTone,
} from "./model";
import { OperationsStrip } from "./OperationsStrip";
import { UploadDialog } from "./UploadDialog";

const CORPORATE_ROLES = ["owner", "org_admin"];

export function DocumentIntakeWorkspace({ initialTab }: { initialTab: IntakeTab }) {
  const router = useRouter();
  const ids = { type: useId(), assigned: useId(), age: useId(), search: useId() };
  const { user, appRole } = useHavenAuth();
  const userId = user?.id ?? null;
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const facilities = useFacilityStore((s) => s.availableFacilities);
  const facilityNames = useMemo(() => Object.fromEntries(facilities.map((f) => [f.id, f.name])), [facilities]);

  const [tab, setTab] = useState<IntakeTab>(initialTab);
  const [catalogCode, setCatalogCode] = useState("");
  const [assigned, setAssigned] = useState<AssignedFilter>("any");
  const [age, setAge] = useState<AgeFilter>("any");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  const [catalog, setCatalog] = useState<CatalogRow[]>([]);
  const [settings, setSettings] = useState<IntakeSettings | null>(null);
  const [items, setItems] = useState<ListedItem[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [counts, setCounts] = useState<Partial<Record<IntakeTab, number>>>({});
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState<{ message: string; forbidden: boolean } | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const sequence = useRef(0);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    const sb = intakeClient();
    void loadCatalog(sb).then(setCatalog).catch(() => setCatalog([]));
    void loadSettings(sb).then(setSettings);
  }, []);

  const filters: ListFilters = useMemo(
    () => ({
      facilityId: selectedFacilityId,
      catalogCode: catalogCode || null,
      assigned,
      userId,
      age,
      alertHours: settings?.pending_alert_hours ?? null,
      search: debouncedSearch,
    }),
    [selectedFacilityId, catalogCode, assigned, userId, age, settings, debouncedSearch],
  );

  const load = useCallback(async () => {
    const current = ++sequence.current;
    setItems(null);
    setError(null);
    const sb = intakeClient();
    try {
      const [page, tabCounts] = await Promise.all([listItems(sb, tab, filters, 0), countTabs(sb, INTAKE_TAB_ORDER, filters)]);
      if (current !== sequence.current) return;
      setItems(page.items);
      setHasMore(page.hasMore);
      setCounts(tabCounts);
      const people = await loadPeopleNames(sb, page.items.map((i) => i.assigned_to));
      if (current === sequence.current) setNames((prior) => ({ ...prior, ...people }));
    } catch (cause) {
      if (current !== sequence.current) return;
      const forbidden = !!(cause && typeof cause === "object" && "forbidden" in cause && (cause as { forbidden: boolean }).forbidden);
      setError({ message: cause instanceof Error ? cause.message : "Documents could not be loaded.", forbidden });
    }
  }, [tab, filters]);

  useEffect(() => {
    void load();
  }, [load, reloadKey]);

  async function loadMore() {
    if (!items) return;
    setLoadingMore(true);
    const current = sequence.current;
    try {
      const sb = intakeClient();
      const page = await listItems(sb, tab, filters, items.length);
      if (current !== sequence.current) return;
      setItems([...items, ...page.items]);
      setHasMore(page.hasMore);
      const people = await loadPeopleNames(sb, page.items.map((i) => i.assigned_to));
      setNames((prior) => ({ ...prior, ...people }));
    } catch (cause) {
      setError({ message: cause instanceof Error ? cause.message : "More documents could not be loaded.", forbidden: false });
    } finally {
      setLoadingMore(false);
    }
  }

  function selectTab(next: IntakeTab) {
    setTab(next);
    router.replace(next === "pending" ? "/admin/document-intake" : `/admin/document-intake?tab=${next}`, { scroll: false });
  }

  const groups = useMemo(() => groupCatalog(catalog), [catalog]);
  const catalogLabels = useMemo(() => Object.fromEntries(catalog.map((c) => [c.code, c.label])), [catalog]);
  const alertHours = settings?.pending_alert_hours ?? null;
  const now = Date.now();
  const scopeName = selectedFacilityId ? (facilityNames[selectedFacilityId] ?? "No facility name posted") : "All facilities";

  return (
    <div className="flex max-w-[1440px] flex-col gap-4 pb-8 pt-2">
      <PageHeader
        title="Document Intake"
        subtitle={`Received documents waiting for a person to check and file them. ${scopeName}.`}
        actions={
          <Button type="button" onClick={() => setUploadOpen(true)}>
            <Plus className="size-4" aria-hidden />
            Add documents
          </Button>
        }
      />

      {CORPORATE_ROLES.includes(appRole) ? <OperationsStrip facilityNames={facilityNames} reloadKey={reloadKey} /> : null}

      <nav aria-label="Document Intake views" className="flex flex-wrap gap-2">
        {INTAKE_TAB_ORDER.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => selectTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === key ? "border-primary bg-muted font-medium text-foreground" : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {INTAKE_TABS[key].label}
            {counts[key] !== undefined ? (
              <span className="tabular-nums text-muted-foreground">{counts[key]}</span>
            ) : (
              <span className="text-muted-foreground">
                <span aria-hidden>—</span>
                <span className="sr-only">count unavailable</span>
              </span>
            )}
          </button>
        ))}
      </nav>

      <div className="grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="grid gap-1">
          <FormLabel htmlFor={ids.search}>Search titles and file names</FormLabel>
          <Input id={ids.search} value={search} onChange={(e) => setSearch(e.target.value)} autoComplete="off" />
        </div>
        <div className="grid gap-1">
          <FormLabel htmlFor={ids.type}>Document type</FormLabel>
          <select id={ids.type} className={FIELD_CLASS} value={catalogCode} onChange={(e) => setCatalogCode(e.target.value)}>
            <option value="">All types</option>
            {groups.map((g) => (
              <optgroup key={g.group} label={g.label}>
                {g.rows.map((row) => (
                  <option key={row.code} value={row.code}>
                    {row.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="grid gap-1">
          <FormLabel htmlFor={ids.assigned}>Assigned</FormLabel>
          <select id={ids.assigned} className={FIELD_CLASS} value={assigned} onChange={(e) => setAssigned(e.target.value as AssignedFilter)}>
            <option value="any">Anyone</option>
            <option value="mine">Assigned to me</option>
            <option value="unassigned">Unassigned</option>
          </select>
        </div>
        <div className="grid gap-1">
          <FormLabel htmlFor={ids.age}>Age</FormLabel>
          <select id={ids.age} className={FIELD_CLASS} value={age} onChange={(e) => setAge(e.target.value as AgeFilter)}>
            <option value="any">Any age</option>
            <option value="today">Received in the last 24 hours</option>
            {alertHours != null ? <option value="overdue">Waiting longer than {alertHours} hours</option> : null}
            <option value="week">Older than 7 days</option>
          </select>
        </div>
      </div>

      {error ? (
        error.forbidden ? (
          <AdminEmptyState title="You can’t review documents" description="Your role does not include Document Intake review. You can still add documents for your facility." />
        ) : (
          <AdminErrorState message={error.message} onRetry={() => setReloadKey((k) => k + 1)} />
        )
      ) : items == null ? (
        <AdminTableLoadingState />
      ) : items.length === 0 ? (
        <AdminEmptyState
          title={tab === "pending" ? "Nothing is waiting for review" : `No documents in ${INTAKE_TABS[tab].label}`}
          description="Change the filters or the facility to see more. New documents appear here once they are received."
        />
      ) : (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <Table aria-label={`${INTAKE_TABS[tab].label} documents`}>
            <TableHeader>
              <TableRow>
                <TableHead>Document</TableHead>
                <TableHead>Facility</TableHead>
                <TableHead>Received (ET)</TableHead>
                <TableHead>Source</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Reading</TableHead>
                <TableHead>Assigned to</TableHead>
                <TableHead className="text-right">Waiting</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((item) => {
                const overdue = isOverdue(item, alertHours, now);
                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-80">
                      <Link href={`/admin/document-intake/${item.id}`} className="block truncate font-medium text-foreground underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                        {itemTitle(item)}
                      </Link>
                      {item.catalog_code ? <span className="block truncate text-xs text-muted-foreground">{catalogLabels[item.catalog_code] ?? "Type not listed"}</span> : null}
                    </TableCell>
                    <TableCell>{item.facility_id ? (facilityNames[item.facility_id] ?? "—") : "Facility unknown"}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">{formatFacilityTimestampEt(item.received_at)}</TableCell>
                    <TableCell>{CHANNEL_LABELS[item.channel]}</TableCell>
                    <TableCell>
                      <StatusPill tone={statusTone(item.status)}>{statusLabel(item.status)}</StatusPill>
                    </TableCell>
                    <TableCell>
                      <StatusPill tone={processingTone(item.processing_state)} dot={false}>
                        {processingLabel(item.processing_state)}
                      </StatusPill>
                    </TableCell>
                    <TableCell>{item.assigned_to ? (item.assigned_to === userId ? "Me" : (names[item.assigned_to] ?? "Assigned")) : "—"}</TableCell>
                    <TableCell className={cn("whitespace-nowrap text-right tabular-nums", overdue && "font-semibold text-destructive")}>
                      {ageLabel(item.received_at, now)}
                      {overdue ? <span className="sr-only"> (overdue)</span> : null}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {hasMore ? (
            <div className="border-t border-border p-3">
              <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Show more"}
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <UploadDialog
        open={uploadOpen}
        onOpenChange={setUploadOpen}
        facilities={facilities}
        defaultFacilityId={selectedFacilityId}
        maxBytes={settings?.max_source_bytes}
        onUploaded={() => setReloadKey((k) => k + 1)}
      />
    </div>
  );
}
