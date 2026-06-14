"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Contact, Loader2, Phone, PhoneCall, Plus } from "lucide-react";

import {
  AdminLiveDataFallbackNotice,
  AdminTableLoadingState,
} from "@/components/common/admin-list-patterns";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import {
  activeOnCall,
  CONTACT_CATEGORIES,
  contactCategoryLabel,
  type ContactCategory,
  type FacilityContactRow,
  type OnCallShiftRow,
  type QueryError,
  type QueryResult,
} from "@/lib/office/contacts";
import { fetchActorContext } from "@/lib/office/meetings";
import { createClient } from "@/lib/supabase/client";
import { isValidFacilityIdForQuery } from "@/lib/supabase/env";
import { cn } from "@/lib/utils";

const ET_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function AdminContactsPage() {
  const supabase = createClient();
  const { selectedFacilityId } = useFacilityStore();
  const facilityReady = isValidFacilityIdForQuery(selectedFacilityId);

  const [contacts, setContacts] = useState<FacilityContactRow[]>([]);
  const [shifts, setShifts] = useState<OnCallShiftRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [categoryFilter, setCategoryFilter] = useState<"all" | ContactCategory>("all");

  const [showContactForm, setShowContactForm] = useState(false);
  const [cName, setCName] = useState("");
  const [cCategory, setCCategory] = useState<ContactCategory>("pharmacy");
  const [cOrg, setCOrg] = useState("");
  const [cPhone, setCPhone] = useState("");
  const [cAfterHours, setCAfterHours] = useState("");
  const [cFax, setCFax] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cNotes, setCNotes] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const [showShiftForm, setShowShiftForm] = useState(false);
  const [sRole, setSRole] = useState("");
  const [sName, setSName] = useState("");
  const [sPhone, setSPhone] = useState("");
  const [sStart, setSStart] = useState(() => toLocalInput(new Date()));
  const [sEnd, setSEnd] = useState(() => toLocalInput(new Date(Date.now() + 12 * 3600 * 1000)));
  const [savingShift, setSavingShift] = useState(false);

  const load = useCallback(async () => {
    if (!facilityReady) {
      setContacts([]);
      setShifts([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(null);
    try {
      const contactsQ = supabase
        .from("facility_contacts" as never)
        .select(
          "id, name, category, organization_name, phone, after_hours_phone, fax, email, address, notes, is_active",
        )
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .order("category")
        .order("name");
      const nowIso = new Date().toISOString();
      const shiftsQ = supabase
        .from("on_call_shifts" as never)
        .select("id, role_label, on_call_user_id, on_call_name, phone, starts_at, ends_at, notes")
        .eq("facility_id", selectedFacilityId as string)
        .is("deleted_at", null)
        .gte("ends_at", nowIso)
        .order("starts_at")
        .limit(100);
      const [cRes, sRes] = await Promise.all([
        contactsQ as unknown as Promise<QueryResult<FacilityContactRow>>,
        shiftsQ as unknown as Promise<QueryResult<OnCallShiftRow>>,
      ]);
      const err: QueryError | null = cRes.error ?? sRes.error;
      if (err) throw new Error(err.message);
      setContacts(cRes.data ?? []);
      setShifts(sRes.data ?? []);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load contacts.");
    } finally {
      setIsLoading(false);
    }
  }, [supabase, selectedFacilityId, facilityReady]);

  useEffect(() => {
    void load();
  }, [load]);

  const createContact = useCallback(async () => {
    if (!facilityReady || !cName.trim()) return;
    setSavingContact(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("facility_contacts" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        name: cName.trim(),
        category: cCategory,
        organization_name: cOrg.trim() || null,
        phone: cPhone.trim() || null,
        after_hours_phone: cAfterHours.trim() || null,
        fax: cFax.trim() || null,
        email: cEmail.trim() || null,
        notes: cNotes.trim() || null,
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setCName("");
      setCOrg("");
      setCPhone("");
      setCAfterHours("");
      setCFax("");
      setCEmail("");
      setCNotes("");
      setShowContactForm(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to save the contact.");
    } finally {
      setSavingContact(false);
    }
  }, [
    supabase,
    facilityReady,
    selectedFacilityId,
    cName,
    cCategory,
    cOrg,
    cPhone,
    cAfterHours,
    cFax,
    cEmail,
    cNotes,
    load,
  ]);

  const createShift = useCallback(async () => {
    if (!facilityReady || !sRole.trim() || !sName.trim()) return;
    if (new Date(sEnd) <= new Date(sStart)) {
      setNotice("On-call end must be after start.");
      return;
    }
    setSavingShift(true);
    setNotice(null);
    try {
      const actor = await fetchActorContext(supabase);
      if (!actor) throw new Error("Could not resolve your profile.");
      const { error } = await supabase.from("on_call_shifts" as never).insert({
        organization_id: actor.organizationId,
        facility_id: selectedFacilityId as string,
        role_label: sRole.trim(),
        on_call_name: sName.trim(),
        phone: sPhone.trim() || null,
        starts_at: new Date(sStart).toISOString(),
        ends_at: new Date(sEnd).toISOString(),
        created_by: actor.userId,
        updated_by: actor.userId,
      } as never);
      if (error) throw new Error(error.message);
      setSRole("");
      setSName("");
      setSPhone("");
      setShowShiftForm(false);
      await load();
    } catch (err) {
      setNotice(err instanceof Error ? err.message : "Failed to save the on-call shift.");
    } finally {
      setSavingShift(false);
    }
  }, [supabase, facilityReady, selectedFacilityId, sRole, sName, sPhone, sStart, sEnd, load]);

  const visibleContacts = useMemo(
    () =>
      categoryFilter === "all"
        ? contacts
        : contacts.filter((c) => c.category === categoryFilter),
    [contacts, categoryFilter],
  );

  const nowIso = new Date().toISOString();
  const onCallNow = useMemo(() => activeOnCall(shifts, nowIso), [shifts, nowIso]);
  const upcomingShifts = useMemo(
    () => shifts.filter((s) => s.starts_at > nowIso),
    [shifts, nowIso],
  );

  const usedCategories = useMemo(() => {
    const set = new Set(contacts.map((c) => c.category));
    return CONTACT_CATEGORIES.filter((c) => set.has(c.id));
  }, [contacts]);

  return (
    <div className="relative min-h-[calc(100vh-64px)] w-full space-y-6 pb-12">
      <div className="relative z-10 space-y-6">
        <header className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight text-foreground flex items-center gap-3">
              <Contact className="h-8 w-8 text-info shrink-0" aria-hidden />
              Contacts & on-call
            </h2>
            <p className="text-sm text-muted-foreground mt-1 max-w-2xl">
              Per-facility rolodex — pharmacy, hospice, physicians, AHCA field office, MCO case
              managers — plus the after-hours on-call schedule.
            </p>
          </div>
        </header>

        {!facilityReady ? (
          <p className="rounded-[var(--radius)] border border-warning/30 bg-warning/10 px-6 py-4 text-sm text-warning">
            Select a facility first — contacts and on-call are per-facility.
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
            <section
              aria-labelledby="on-call-heading"
              className="space-y-3 rounded-[var(--radius)] border border-border bg-card/60 p-4"
            >
              <div className="flex items-center justify-between gap-3">
                <h3 id="on-call-heading" className="text-lg font-semibold text-foreground flex items-center gap-2">
                  <PhoneCall className="h-5 w-5 text-info" aria-hidden />
                  On-call now
                </h3>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-2 font-medium text-[10px] uppercase tracking-wider"
                  onClick={() => setShowShiftForm((v) => !v)}
                >
                  <Plus className="h-4 w-4" aria-hidden />
                  {showShiftForm ? "Close" : "Add shift"}
                </Button>
              </div>

              {onCallNow.length === 0 ? (
                <p className="text-sm text-muted-foreground">No one is currently scheduled on-call.</p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {onCallNow.map((s) => (
                    <li
                      key={s.id}
                      className="rounded-[9px] border border-info/40 bg-info/10 px-[13px] py-2"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground">{s.role_label}</span>
                        <StatusPill tone="info">on call</StatusPill>
                      </div>
                      <p className="text-sm text-foreground">{s.on_call_name}</p>
                      {s.phone ? (
                        <a
                          href={`tel:${s.phone}`}
                          className="text-sm text-info inline-flex items-center gap-1 hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          {s.phone}
                        </a>
                      ) : null}
                      <p className="text-xs text-muted-foreground mt-0.5">
                        until {ET_FMT.format(new Date(s.ends_at))} ET
                      </p>
                    </li>
                  ))}
                </ul>
              )}

              {showShiftForm ? (
                <div className="grid gap-2 rounded-[9px] border border-border bg-background p-3 lg:grid-cols-2">
                  <input
                    type="text"
                    value={sRole}
                    onChange={(e) => setSRole(e.target.value)}
                    placeholder="Role (e.g. Administrator on-call)"
                    aria-label="On-call role"
                    className="rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                  />
                  <input
                    type="text"
                    value={sName}
                    onChange={(e) => setSName(e.target.value)}
                    placeholder="Person on call"
                    aria-label="Person on call"
                    className="rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                  />
                  <input
                    type="tel"
                    value={sPhone}
                    onChange={(e) => setSPhone(e.target.value)}
                    placeholder="Phone"
                    aria-label="On-call phone"
                    className="rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Starts
                      <input
                        type="datetime-local"
                        value={sStart}
                        onChange={(e) => setSStart(e.target.value)}
                        className="rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                    <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                      Ends
                      <input
                        type="datetime-local"
                        value={sEnd}
                        onChange={(e) => setSEnd(e.target.value)}
                        className="rounded-[9px] border border-border bg-card px-3 py-2 text-sm text-foreground"
                      />
                    </label>
                  </div>
                  <Button
                    type="button"
                    disabled={savingShift || !sRole.trim() || !sName.trim()}
                    onClick={() => void createShift()}
                    className="gap-2 lg:col-span-2"
                  >
                    {savingShift ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    Save on-call shift
                  </Button>
                </div>
              ) : null}

              {upcomingShifts.length > 0 ? (
                <div className="space-y-1 pt-1">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Upcoming
                  </p>
                  <ul className="space-y-1">
                    {upcomingShifts.map((s) => (
                      <li key={s.id} className="text-sm text-muted-foreground">
                        <span className="text-foreground font-medium">{s.role_label}</span> —{" "}
                        {s.on_call_name} · {ET_FMT.format(new Date(s.starts_at))} →{" "}
                        {ET_FMT.format(new Date(s.ends_at))} ET
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </section>

            <section aria-labelledby="rolodex-heading" className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 px-[13px] py-2 rounded-[var(--radius)] border border-border bg-card/60">
                <h3 id="rolodex-heading" className="text-lg font-semibold text-foreground">
                  Directory
                  <span className="ml-2 text-sm font-normal text-muted-foreground tabular-nums">
                    {visibleContacts.length}
                  </span>
                </h3>
                <div className="flex flex-wrap items-center gap-1.5">
                  <button
                    type="button"
                    aria-pressed={categoryFilter === "all"}
                    onClick={() => setCategoryFilter("all")}
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                      categoryFilter === "all"
                        ? "bg-primary text-primary-foreground"
                        : "bg-card text-muted-foreground border border-border hover:bg-muted",
                    )}
                  >
                    All
                  </button>
                  {usedCategories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      aria-pressed={categoryFilter === c.id}
                      onClick={() => setCategoryFilter(c.id)}
                      className={cn(
                        "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                        categoryFilter === c.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-card text-muted-foreground border border-border hover:bg-muted",
                      )}
                    >
                      {c.label}
                    </button>
                  ))}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-2 font-medium text-[10px] uppercase tracking-wider"
                    onClick={() => setShowContactForm((v) => !v)}
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {showContactForm ? "Close" : "New contact"}
                  </Button>
                </div>
              </div>

              {showContactForm ? (
                <div className="grid gap-2 rounded-[var(--radius)] border border-border bg-card p-4 lg:grid-cols-2">
                  <input
                    type="text"
                    value={cName}
                    onChange={(e) => setCName(e.target.value)}
                    placeholder="Contact name"
                    aria-label="Contact name"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <select
                    value={cCategory}
                    onChange={(e) => setCCategory(e.target.value as ContactCategory)}
                    aria-label="Contact category"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  >
                    {CONTACT_CATEGORIES.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                  <input
                    type="text"
                    value={cOrg}
                    onChange={(e) => setCOrg(e.target.value)}
                    placeholder="Organization (optional)"
                    aria-label="Organization"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <input
                    type="tel"
                    value={cPhone}
                    onChange={(e) => setCPhone(e.target.value)}
                    placeholder="Phone"
                    aria-label="Phone"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <input
                    type="tel"
                    value={cAfterHours}
                    onChange={(e) => setCAfterHours(e.target.value)}
                    placeholder="After-hours phone"
                    aria-label="After-hours phone"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <input
                    type="text"
                    value={cFax}
                    onChange={(e) => setCFax(e.target.value)}
                    placeholder="Fax (optional)"
                    aria-label="Fax"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <input
                    type="email"
                    value={cEmail}
                    onChange={(e) => setCEmail(e.target.value)}
                    placeholder="Email (optional)"
                    aria-label="Email"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <input
                    type="text"
                    value={cNotes}
                    onChange={(e) => setCNotes(e.target.value)}
                    placeholder="Notes (optional)"
                    aria-label="Notes"
                    className="rounded-[9px] border border-border bg-background px-3 py-2 text-sm text-foreground"
                  />
                  <Button
                    type="button"
                    disabled={savingContact || !cName.trim()}
                    onClick={() => void createContact()}
                    className="gap-2 lg:col-span-2"
                  >
                    {savingContact ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
                    Save contact
                  </Button>
                </div>
              ) : null}

              {visibleContacts.length === 0 ? (
                <p className="text-sm text-muted-foreground pl-2">
                  No contacts{categoryFilter === "all" ? "" : " in this category"} yet.
                </p>
              ) : (
                <ul className="grid gap-2 sm:grid-cols-2">
                  {visibleContacts.map((c) => (
                    <li
                      key={c.id}
                      className="rounded-[9px] border border-border bg-card px-[13px] py-2 space-y-0.5"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-foreground truncate">{c.name}</span>
                        <StatusPill tone="muted">{contactCategoryLabel(c.category)}</StatusPill>
                      </div>
                      {c.organization_name ? (
                        <p className="text-xs text-muted-foreground">{c.organization_name}</p>
                      ) : null}
                      {c.phone ? (
                        <a
                          href={`tel:${c.phone}`}
                          className="text-sm text-info inline-flex items-center gap-1 hover:underline"
                        >
                          <Phone className="h-3.5 w-3.5" aria-hidden />
                          {c.phone}
                        </a>
                      ) : null}
                      {c.after_hours_phone ? (
                        <p className="text-xs text-muted-foreground">
                          After hours: {c.after_hours_phone}
                        </p>
                      ) : null}
                      {c.email ? (
                        <p className="text-xs text-muted-foreground truncate">{c.email}</p>
                      ) : null}
                      {c.notes ? <p className="text-xs text-muted-foreground">{c.notes}</p> : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        ) : null}
      </div>
    </div>
  );
}
