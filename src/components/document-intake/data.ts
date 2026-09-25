/**
 * Reads for the review UI. Everything goes through the signed-in person's
 * Supabase client, so RLS decides what a reviewer sees; nothing here selects
 * the item's storage_path or object_id.
 *
 * Migration 545 is not in src/types/database.ts yet, so these reads use an
 * untyped client and parse rows with the contract schemas.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  catalogRowSchema,
  eventRowSchema,
  filingRowSchema,
  itemSchema,
  proposalRowSchema,
  type CatalogRow,
  type EventRow,
  type FilingRow,
  type IntakeItem,
  type IntakeTab,
  type ProposalRow,
} from "@/lib/document-intake/contracts";
import { createClient } from "@/lib/supabase/client";

import { tabStatuses } from "./model";

export function intakeClient(): SupabaseClient {
  return createClient() as unknown as SupabaseClient;
}

/** Every item column the UI reads. storage_path and object_id are never selected. */
export const ITEM_COLUMNS = [
  "id",
  "organization_id",
  "facility_id",
  "channel",
  "message_id",
  "parent_item_id",
  "parent_pages",
  "original_filename",
  "display_title",
  "declared_mime",
  "declared_size_bytes",
  "declared_sha256",
  "verified_mime",
  "verified_sha256",
  "page_count",
  "status",
  "processing_state",
  "processing_reason",
  "attention_reason",
  "hold_reason",
  "exclude_reason",
  "duplicate_of",
  "assigned_to",
  "claimed_by",
  "claim_expires_at",
  "current_proposal_id",
  "revision",
  "sender_address",
  "sender_authenticated",
  "received_at",
  "created_by",
  "created_principal",
  "created_at",
  "updated_at",
  "deleted_at",
].join(",");

const PROPOSAL_EMBED = "proposal:document_intake_proposals!document_intake_items_current_proposal_fkey";

export class IntakeReadError extends Error {
  constructor(
    message: string,
    public forbidden: boolean,
  ) {
    super(message);
  }
}

function readError(error: { code?: string; message?: string }, fallback: string): IntakeReadError {
  const forbidden = error.code === "42501" || /permission denied/i.test(error.message ?? "");
  return new IntakeReadError(forbidden ? "You do not have access to this." : fallback, forbidden);
}

/** Strip the characters PostgREST's or=() filter treats as syntax. */
export function sanitizeSearch(value: string): string {
  return value.replace(/[,()*%\\:"']/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export type AssignedFilter = "any" | "mine" | "unassigned";
export type AgeFilter = "any" | "overdue" | "today" | "week";

export type ListFilters = {
  facilityId: string | null;
  catalogCode: string | null;
  assigned: AssignedFilter;
  userId: string | null;
  age: AgeFilter;
  alertHours: number | null;
  search: string;
};

export type ListedItem = IntakeItem & { catalog_code: string | null };

// PostgREST builders are thenables with chainable filters; typing them loosely
// keeps one filter function for both the list and the head counts.
type FilterableQuery = {
  in: (column: string, values: readonly string[]) => FilterableQuery;
  eq: (column: string, value: string) => FilterableQuery;
  is: (column: string, value: null) => FilterableQuery;
  lt: (column: string, value: string) => FilterableQuery;
  gte: (column: string, value: string) => FilterableQuery;
  or: (filters: string) => FilterableQuery;
};

function applyFilters<Q>(query: Q, tab: IntakeTab, filters: ListFilters, now: number): Q {
  let q = query as unknown as FilterableQuery;
  q = q.in("status", tabStatuses(tab)).is("deleted_at", null);
  if (filters.facilityId) q = q.eq("facility_id", filters.facilityId);
  if (filters.catalogCode) q = q.eq("proposal.catalog_code", filters.catalogCode);
  if (filters.assigned === "mine" && filters.userId) q = q.eq("assigned_to", filters.userId);
  if (filters.assigned === "unassigned") q = q.is("assigned_to", null);
  if (filters.age === "overdue" && filters.alertHours != null) q = q.lt("received_at", new Date(now - filters.alertHours * 3_600_000).toISOString());
  if (filters.age === "today") q = q.gte("received_at", new Date(now - 24 * 3_600_000).toISOString());
  if (filters.age === "week") q = q.lt("received_at", new Date(now - 7 * 24 * 3_600_000).toISOString());
  const search = sanitizeSearch(filters.search);
  if (search) q = q.or(`display_title.ilike.*${search}*,original_filename.ilike.*${search}*`);
  return q as unknown as Q;
}

function embedFor(filters: ListFilters, columns: string): string {
  return `${PROPOSAL_EMBED}${filters.catalogCode ? "!inner" : ""}(${columns})`;
}

export const LIST_PAGE_SIZE = 50;

export async function listItems(
  sb: SupabaseClient,
  tab: IntakeTab,
  filters: ListFilters,
  offset: number,
  now: number = Date.now(),
): Promise<{ items: ListedItem[]; hasMore: boolean }> {
  const base = sb.from("document_intake_items").select(`${ITEM_COLUMNS},${embedFor(filters, "catalog_code")}`);
  // Work queues read oldest first; the record tabs read newest first.
  const ascending = tab === "pending" || tab === "attention" || tab === "processing";
  const { data, error } = await applyFilters(base, tab, filters, now)
    .order("received_at", { ascending })
    .order("id", { ascending: true })
    .range(offset, offset + LIST_PAGE_SIZE);
  if (error) throw readError(error, "Documents could not be loaded.");
  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const items = rows.slice(0, LIST_PAGE_SIZE).flatMap((row) => {
    const parsed = itemSchema.safeParse(row);
    if (!parsed.success) return [];
    const embed = row.proposal as { catalog_code?: string | null } | Array<{ catalog_code?: string | null }> | null;
    const proposal = Array.isArray(embed) ? embed[0] : embed;
    return [{ ...parsed.data, catalog_code: proposal?.catalog_code ?? null }];
  });
  return { items, hasMore: rows.length > LIST_PAGE_SIZE };
}

export async function countTabs(
  sb: SupabaseClient,
  tabs: readonly IntakeTab[],
  filters: ListFilters,
  now: number = Date.now(),
): Promise<Partial<Record<IntakeTab, number>>> {
  const results = await Promise.all(
    tabs.map(async (tab) => {
      const base = sb.from("document_intake_items").select(`id,${embedFor(filters, "id")}`, { count: "exact", head: true });
      const { count, error } = await applyFilters(base, tab, filters, now);
      // A missing count is unknown ("—"), never a confident 0.
      return [tab, error || count == null ? undefined : count] as const;
    }),
  );
  return Object.fromEntries(results.filter(([, n]) => n !== undefined));
}

export async function loadCatalog(sb: SupabaseClient): Promise<CatalogRow[]> {
  const { data, error } = await sb
    .from("document_intake_catalog")
    .select("id,organization_id,code,label,description,document_group,destination_kind,destination_category,subject_kind,contains_phi,reviewer_roles,reader_enabled,jev_enabled,reader_hint,active,sort_order,revision")
    .order("sort_order", { ascending: true });
  if (error) throw readError(error, "Document types could not be loaded.");
  return (data ?? []).flatMap((row) => {
    const parsed = catalogRowSchema.safeParse(row);
    return parsed.success ? [parsed.data] : [];
  });
}

export type IntakeSettings = { pending_alert_hours: number; claim_minutes: number; max_source_bytes: number; custodian_roles: string[]; review_roles: string[]; upload_roles: string[] };

export async function loadSettings(sb: SupabaseClient): Promise<IntakeSettings | null> {
  const { data, error } = await sb
    .from("document_intake_settings")
    .select("pending_alert_hours,claim_minutes,max_source_bytes,custodian_roles,review_roles,upload_roles")
    .maybeSingle();
  if (error || !data) return null;
  return data as IntakeSettings;
}

export async function loadPeopleNames(sb: SupabaseClient, ids: ReadonlyArray<string | null | undefined>): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((id): id is string => !!id))];
  if (unique.length === 0) return {};
  const { data } = await sb.from("user_profiles").select("id,full_name").in("id", unique);
  return Object.fromEntries(((data ?? []) as Array<{ id: string; full_name: string | null }>).filter((p) => p.full_name).map((p) => [p.id, p.full_name as string]));
}

export type ItemDetail = {
  item: IntakeItem;
  proposal: ProposalRow | null;
  filings: FilingRow[];
  events: EventRow[];
  children: Array<Pick<IntakeItem, "id" | "display_title" | "original_filename" | "status" | "parent_pages">>;
};

export async function loadItemDetail(sb: SupabaseClient, itemId: string): Promise<ItemDetail | null> {
  const { data: row, error } = await sb.from("document_intake_items").select(ITEM_COLUMNS).eq("id", itemId).maybeSingle();
  if (error) throw readError(error, "This document could not be loaded.");
  if (!row) return null;
  const parsedItem = itemSchema.safeParse(row);
  if (!parsedItem.success) throw new IntakeReadError("This document could not be read.", false);
  const item = parsedItem.data;

  const [proposalRes, filingsRes, eventsRes, childrenRes] = await Promise.all([
    item.current_proposal_id
      ? sb.from("document_intake_proposals").select("*").eq("id", item.current_proposal_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    sb
      .from("document_intake_filings")
      .select("id,item_id,facility_id,catalog_code,destination_kind,destination_category,subject_id,title,destination_record_id,state,reviewer_changes,approved_by,approved_at,corrected_by,corrected_at,correction_reason,created_at,document_date,expiration_date")
      .eq("item_id", item.id)
      .order("created_at", { ascending: false }),
    sb.from("document_intake_events").select("id,item_id,event,actor_id,principal,detail,created_at").eq("item_id", item.id).order("created_at", { ascending: true }).limit(300),
    item.status === "split"
      ? sb.from("document_intake_items").select("id,display_title,original_filename,status,parent_pages").eq("parent_item_id", item.id).is("deleted_at", null)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const proposalParsed = proposalRes.data ? proposalRowSchema.safeParse(proposalRes.data) : null;
  return {
    item,
    proposal: proposalParsed?.success ? proposalParsed.data : null,
    filings: ((filingsRes.data ?? []) as unknown[]).flatMap((f) => {
      const parsed = filingRowSchema.safeParse(f);
      return parsed.success ? [parsed.data] : [];
    }),
    events: ((eventsRes.data ?? []) as unknown[]).flatMap((e) => {
      const parsed = eventRowSchema.safeParse(e);
      return parsed.success ? [parsed.data] : [];
    }),
    children: (childrenRes.data ?? []) as ItemDetail["children"],
  };
}

// ── Destination search (scoped by RLS to what this person may see) ─────────

export type SearchResult<T> = { rows: T[]; forbidden: boolean };

export type ResidentOption = { id: string; name: string; room: string | null; dateOfBirth: string | null; status: string | null };

type ResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  preferred_name: string | null;
  date_of_birth: string | null;
  status: string | null;
  bed_by_id: { bed_label: string | null; rooms: { room_number: string | null } | null } | null;
};

export function residentDisplayName(row: Pick<ResidentRow, "first_name" | "last_name" | "preferred_name">): string {
  const first = row.preferred_name?.trim() || row.first_name?.trim() || "";
  return [first, row.last_name?.trim() ?? ""].filter(Boolean).join(" ") || "Name not recorded";
}

export async function searchResidents(sb: SupabaseClient, facilityId: string, query: string): Promise<SearchResult<ResidentOption>> {
  let q = sb
    .from("residents")
    .select("id,first_name,last_name,preferred_name,date_of_birth,status,bed_by_id:beds!residents_bed_id_fkey(bed_label,rooms(room_number))")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("last_name", { ascending: true })
    .limit(25);
  const search = sanitizeSearch(query);
  if (search) q = q.or(`first_name.ilike.*${search}*,last_name.ilike.*${search}*,preferred_name.ilike.*${search}*`);
  const { data, error } = await q;
  if (error) {
    if (readError(error, "").forbidden) return { rows: [], forbidden: true };
    throw readError(error, "Residents could not be loaded.");
  }
  return {
    forbidden: false,
    rows: ((data ?? []) as unknown as ResidentRow[]).map((row) => {
      const room = row.bed_by_id?.rooms?.room_number;
      return {
        id: row.id,
        name: residentDisplayName(row),
        room: room ? `${room}${row.bed_by_id?.bed_label ? `-${row.bed_by_id.bed_label}` : ""}` : null,
        dateOfBirth: row.date_of_birth,
        status: row.status,
      };
    }),
  };
}

export type StaffOption = { id: string; name: string; role: string | null };

export async function searchStaff(sb: SupabaseClient, facilityId: string, query: string): Promise<SearchResult<StaffOption>> {
  let q = sb
    .from("staff")
    .select("id,first_name,last_name,preferred_name,staff_role")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .order("last_name", { ascending: true })
    .limit(25);
  const search = sanitizeSearch(query);
  if (search) q = q.or(`first_name.ilike.*${search}*,last_name.ilike.*${search}*,preferred_name.ilike.*${search}*`);
  const { data, error } = await q;
  if (error) {
    if (readError(error, "").forbidden) return { rows: [], forbidden: true };
    throw readError(error, "Staff could not be loaded.");
  }
  return {
    forbidden: false,
    rows: ((data ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null; preferred_name: string | null; staff_role: string | null }>).map((row) => ({
      id: row.id,
      name: residentDisplayName(row),
      role: row.staff_role,
    })),
  };
}

export type RequirementOption = { id: string; code: string; title: string; category: string };

export async function loadRequirements(sb: SupabaseClient, facilityId: string): Promise<SearchResult<RequirementOption>> {
  const { data, error } = await sb
    .from("employee_file_requirements")
    .select("id,code,title,category,review_status")
    .eq("facility_id", facilityId)
    .is("deleted_at", null)
    .neq("review_status", "retired")
    .order("code", { ascending: true })
    .limit(200);
  if (error) {
    if (readError(error, "").forbidden) return { rows: [], forbidden: true };
    throw readError(error, "Staff file requirements could not be loaded.");
  }
  return { forbidden: false, rows: (data ?? []) as RequirementOption[] };
}

export type MedicaidCaseOption = { id: string; name: string; program: string; status: string };

/** Medicaid cases are only readable through the benefits routes (no direct table grant). */
export async function searchMedicaidCases(facilityId: string, query: string): Promise<SearchResult<MedicaidCaseOption>> {
  const params = new URLSearchParams({ limit: "100", facility_id: facilityId });
  const response = await fetch(`/api/admin/benefits/cases?${params}`, { credentials: "same-origin", cache: "no-store" });
  if (response.status === 401 || response.status === 403) return { rows: [], forbidden: true };
  if (!response.ok) throw new IntakeReadError("Medicaid cases could not be loaded.", false);
  const body = (await response.json().catch(() => null)) as { cases?: Array<{ id: string; resident_name: string; program: string; status: string }> } | null;
  const needle = query.trim().toLowerCase();
  return {
    forbidden: false,
    rows: (body?.cases ?? [])
      .filter((c) => c.status !== "closed" && (!needle || c.resident_name.toLowerCase().includes(needle)))
      .map((c) => ({ id: c.id, name: c.resident_name, program: c.program, status: c.status })),
  };
}

export type ItemOption = Pick<IntakeItem, "id" | "display_title" | "original_filename" | "received_at" | "status">;

/** Other documents at the same facility, for "Mark duplicate". */
export async function searchOtherItems(sb: SupabaseClient, item: Pick<IntakeItem, "id" | "facility_id">, query: string): Promise<ItemOption[]> {
  let q = sb
    .from("document_intake_items")
    .select("id,display_title,original_filename,received_at,status")
    .neq("id", item.id)
    .is("deleted_at", null)
    .neq("status", "split")
    .order("received_at", { ascending: false })
    .limit(25);
  q = item.facility_id ? q.eq("facility_id", item.facility_id) : q.is("facility_id", null);
  const search = sanitizeSearch(query);
  if (search) q = q.or(`display_title.ilike.*${search}*,original_filename.ilike.*${search}*`);
  const { data, error } = await q;
  if (error) throw readError(error, "Documents could not be loaded.");
  return (data ?? []) as ItemOption[];
}

export type ReviewerOption = { id: string; name: string; coverage: string };

export async function loadReviewers(sb: SupabaseClient, facilityId: string | null): Promise<ReviewerOption[]> {
  let q = sb.from("document_intake_reviewers").select("user_id,coverage").is("revoked_at", null);
  q = facilityId ? q.or(`facility_id.eq.${facilityId},coverage.eq.custodian`) : q.eq("coverage", "custodian");
  const { data } = await q;
  const rows = (data ?? []) as Array<{ user_id: string; coverage: string }>;
  const names = await loadPeopleNames(sb, rows.map((r) => r.user_id));
  const seen = new Set<string>();
  return rows.flatMap((r) => {
    if (seen.has(r.user_id)) return [];
    seen.add(r.user_id);
    return [{ id: r.user_id, name: names[r.user_id] ?? "Name not recorded", coverage: r.coverage }];
  });
}
