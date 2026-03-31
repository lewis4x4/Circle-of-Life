import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/types/database";

export type FamilyFeedIncidentItem = {
  kind: "incident";
  id: string;
  sortAt: string;
  residentId: string;
  residentName: string;
  title: string;
  detail: string;
  timeLabel: string;
  badge: string;
};

export type FamilyFeedInvoiceItem = {
  kind: "invoice";
  id: string;
  sortAt: string;
  residentId: string;
  residentName: string;
  title: string;
  detail: string;
  timeLabel: string;
  badge: string;
  href: string;
};

export type FamilyFeedItem = FamilyFeedIncidentItem | FamilyFeedInvoiceItem;

/** Data for `/family` home feed (RLS-scoped). */
export type FamilyHomeSnapshot = {
  linkedResidents: number;
  /** Display names for header context */
  residentSummary: string;
  stats: {
    linkedResidents: string;
    clinicalWeek: string;
    billingOpen: string;
    feedToday: string;
  };
  items: FamilyFeedItem[];
};

const INCIDENT_CATEGORY_LABELS: Partial<Record<Database["public"]["Enums"]["incident_category"], string>> = {
  fall_with_injury: "Fall with injury",
  fall_without_injury: "Fall without injury",
  fall_witnessed: "Fall (witnessed)",
  fall_unwitnessed: "Fall (unwitnessed)",
  elopement: "Elopement",
  wandering: "Wandering",
  medication_error: "Medication error",
  medication_refusal: "Medication refusal",
  behavioral_resident_to_resident: "Behavioral event",
  behavioral_resident_to_staff: "Behavioral event",
  environmental_flood: "Environmental concern",
  environmental_fire: "Environmental concern",
  other: "Incident update",
};

const REDACTED_INCIDENT_DETAIL =
  "An incident was documented for your loved one. Contact the care team if you have questions.";

function residentDisplayName(row: {
  preferred_name: string | null;
  first_name: string | null;
  last_name: string | null;
}): string {
  return (
    row.preferred_name?.trim() ||
    [row.first_name, row.last_name].filter(Boolean).join(" ").trim() ||
    "Your loved one"
  );
}

function formatMoney(n: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

function truncate(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1)}…`;
}

function isCalendarToday(iso: string, now: Date): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function startOfDayUtc(now: Date): number {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

/**
 * Loads linked residents, recent incidents, and invoices visible to the signed-in family user (RLS).
 */
export async function fetchFamilyHomeSnapshot(
  supabase: SupabaseClient<Database>,
): Promise<{ ok: true; data: FamilyHomeSnapshot } | { ok: false; error: string }> {
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();
  if (userErr) return { ok: false, error: userErr.message };
  if (!user) return { ok: false, error: "Sign in to see your feed." };

  const linkQ = await supabase
    .from("family_resident_links")
    .select("resident_id, can_view_clinical, can_view_financial")
    .eq("user_id", user.id)
    .is("revoked_at", null);

  if (linkQ.error) return { ok: false, error: linkQ.error.message };

  const links = (linkQ.data ?? []) as {
    resident_id: string;
    can_view_clinical: boolean;
    can_view_financial: boolean;
  }[];

  if (links.length === 0) {
    return {
      ok: true,
      data: {
        linkedResidents: 0,
        residentSummary: "",
        stats: {
          linkedResidents: "0",
          clinicalWeek: "0",
          billingOpen: "0",
          feedToday: "0",
        },
        items: [],
      },
    };
  }

  const linkByResident = new Map(links.map((l) => [l.resident_id, l] as const));
  const residentIds = [...new Set(links.map((l) => l.resident_id))];

  const [resQ, incQ, invQ] = await Promise.all([
    supabase
      .from("residents")
      .select("id, first_name, last_name, preferred_name")
      .in("id", residentIds)
      .is("deleted_at", null),
    supabase
      .from("incidents")
      .select("id, resident_id, category, description, occurred_at, status, incident_number")
      .not("resident_id", "is", null)
      .order("occurred_at", { ascending: false })
      .limit(25),
    supabase
      .from("invoices")
      .select("id, resident_id, invoice_number, status, total, balance_due, invoice_date")
      .order("invoice_date", { ascending: false })
      .limit(20),
  ]);

  if (resQ.error) return { ok: false, error: resQ.error.message };
  if (incQ.error) return { ok: false, error: incQ.error.message };
  if (invQ.error) return { ok: false, error: invQ.error.message };

  const nameById = new Map(
    (resQ.data ?? []).map((r) => {
      const row = r as {
        id: string;
        first_name: string | null;
        last_name: string | null;
        preferred_name: string | null;
      };
      return [row.id, residentDisplayName(row)] as const;
    }),
  );

  const names = residentIds.map((id) => nameById.get(id) ?? "Your loved one");
  const residentSummary =
    names.length === 1 ? names[0] : names.length === 2 ? `${names[0]} and ${names[1]}` : `${names[0]} and others`;

  const now = new Date();
  const weekAgo = startOfDayUtc(now) - 6 * 86400000;

  const items: FamilyFeedItem[] = [];

  for (const raw of incQ.data ?? []) {
    const inc = raw as {
      id: string;
      resident_id: string;
      category: Database["public"]["Enums"]["incident_category"];
      description: string;
      occurred_at: string;
      status: string;
      incident_number: string;
    };
    const link = linkByResident.get(inc.resident_id);
    if (!link) continue;

    const clinical = link.can_view_clinical;
    const catLabel = INCIDENT_CATEGORY_LABELS[inc.category] ?? inc.category.replace(/_/g, " ");
    const title = `${catLabel} · #${inc.incident_number}`;
    const detail = clinical ? truncate(inc.description, 220) : REDACTED_INCIDENT_DETAIL;
    const badge = clinical ? "Clinical" : "Update";

    items.push({
      kind: "incident",
      id: inc.id,
      sortAt: inc.occurred_at,
      residentId: inc.resident_id,
      residentName: nameById.get(inc.resident_id) ?? "Your loved one",
      title,
      detail,
      timeLabel: formatShortTime(inc.occurred_at),
      badge,
    });
  }

  for (const raw of invQ.data ?? []) {
    const inv = raw as {
      id: string;
      resident_id: string;
      invoice_number: string;
      status: string;
      total: number;
      balance_due: number;
      invoice_date: string;
    };
    if (!linkByResident.get(inv.resident_id)?.can_view_financial) continue;

    const statusLabel = inv.status.replace(/_/g, " ");
    const title = `Invoice ${inv.invoice_number}`;
    const detail = `Status: ${statusLabel} · Balance ${formatMoney(inv.balance_due)} · Total ${formatMoney(inv.total)}`;
    const sortAt = `${inv.invoice_date}T12:00:00.000Z`;

    items.push({
      kind: "invoice",
      id: inv.id,
      sortAt,
      residentId: inv.resident_id,
      residentName: nameById.get(inv.resident_id) ?? "Your loved one",
      title,
      detail,
      timeLabel: formatShortTime(sortAt),
      badge: "Billing",
      href: "/family/invoices",
    });
  }

  items.sort((a, b) => new Date(b.sortAt).getTime() - new Date(a.sortAt).getTime());

  const topItems = items.slice(0, 18);

  const incidentsWeek = (incQ.data ?? []).filter((row) => {
    const inc = row as { resident_id: string; occurred_at: string };
    if (!linkByResident.has(inc.resident_id)) return false;
    return new Date(inc.occurred_at).getTime() >= weekAgo;
  }).length;

  const openInvoices = (invQ.data ?? []).filter((row) => {
    const inv = row as { resident_id: string; status: string };
    if (!linkByResident.get(inv.resident_id)?.can_view_financial) return false;
    const st = inv.status;
    return st !== "paid" && st !== "void" && st !== "written_off";
  }).length;

  const feedToday = items.filter((it) => isCalendarToday(it.sortAt, now)).length;

  return {
    ok: true,
    data: {
      linkedResidents: links.length,
      residentSummary,
      stats: {
        linkedResidents: String(links.length),
        clinicalWeek: String(incidentsWeek),
        billingOpen: String(openInvoices),
        feedToday: String(feedToday),
      },
      items: topItems,
    },
  };
}
