"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Bolt,
  Building2,
  Loader2,
  MoreHorizontal,
  Plus,
  Printer,
  Shield,
  Stethoscope,
  Wrench,
} from "lucide-react";
import { toast } from "sonner";
import { useFacilityEmergencyContacts } from "@/hooks/useFacilityEmergencyContacts";
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
} from "@/lib/admin/facilities/facility-constants";
import type { ContactCategory } from "@/lib/admin/facilities/facility-constants";
import type { EmergencyContactInput } from "@/lib/validation/facility-admin";
import {
  CATEGORY_GROUP,
  GROUP_ORDER,
  PARENT_GROUP_LABEL,
  type ParentGroupId,
  categoryLabelForRow,
  filterEmergencyContacts,
  firstByCategory,
  formatContactDisplay,
  countMissingEmergencySlots,
  type SlotContext,
} from "@/lib/admin/facilities/emergency-directory";
import { PhoneLink } from "@/components/common/phone-link";
import { FieldLabel } from "@/design-system/components/record-detail";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  formatEmergencyTabHoursLine,
  formatEmergencyTabPhone,
  formatEmergencyTabVerifyLine,
} from "@/lib/facilities/emergency-tab-display-copy";
import { cn } from "@/lib/utils";

type ContactsApi = ReturnType<typeof useFacilityEmergencyContacts>;

const inputCls =
  "mt-1 w-full rounded-[8px] border border-border bg-background px-2 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring";

const US_POISON = "1-800-222-1222";
/** Florida APS / elder abuse hotline — dialable digits for tel: */
const FL_APS_PHONE = "1-800-962-2873";

function GroupHeaderIcon({ group }: { group: ParentGroupId }) {
  const cls = "h-4 w-4 text-muted-foreground shrink-0";
  switch (group) {
    case "public_safety":
      return <Shield className={cls} aria-hidden />;
    case "county_city":
      return <Building2 className={cls} aria-hidden />;
    case "utilities":
      return <Bolt className={cls} aria-hidden />;
    case "building_systems":
      return <Wrench className={cls} aria-hidden />;
    default:
      return <Stethoscope className={cls} aria-hidden />;
  }
}

function verificationBadge() {
  return (
    <span className="rounded-[6px] bg-warning/15 px-2 py-0.5 text-[11px] font-medium tabular-nums text-warning">
      Not verified
    </span>
  );
}

function DirectionsLink({ address }: { address: string }) {
  const href = `https://maps.google.com/?q=${encodeURIComponent(address)}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-[12px] font-medium text-primary underline-offset-4 hover:underline"
    >
      Directions →
    </a>
  );
}

function EmergencyQuickStrip({
  sheriff,
  fireAlarm,
  hospital,
}: {
  sheriff?: { contact_name: string; phone_primary: string };
  fireAlarm?: { contact_name: string; phone_primary: string };
  hospital?: { contact_name: string; phone_primary: string; address: string | null };
}) {
  const rows: {
    key: string;
    name: string;
    sub?: string;
    phone: string | null;
    dial?: boolean;
    verify: string | null;
  }[] = [
    {
      key: "911",
      name: "911",
      sub: "Life safety, fire, medical emergency, active crime",
      phone: null,
      dial: false,
      verify: null,
    },
    {
      key: "sheriff",
      name: sheriff?.contact_name ?? "Sheriff dispatch",
      phone: sheriff?.phone_primary ?? null,
      dial: true,
      verify: null,
    },
    {
      key: "fire",
      name: fireAlarm?.contact_name ?? "Fire alarm monitoring",
      phone: fireAlarm?.phone_primary ?? null,
      dial: true,
      verify: null,
    },
    {
      key: "er",
      name: hospital?.contact_name ?? "Closest receiving hospital ER",
      phone: hospital?.phone_primary ?? null,
      dial: true,
      verify: null,
    },
  ];

  return (
    <div className="rounded-[10px] border-2 border-border/80 bg-muted/30 p-4 shadow-sm">
      <FieldLabel className="text-[13px] font-semibold text-muted-foreground">Immediate emergency</FieldLabel>
      <ul className="mt-3 divide-y divide-border/80">
        {rows.map((r) => (
          <li key={r.key} className="flex flex-wrap items-start gap-3 py-2.5 first:pt-0">
            <span className="text-base" aria-hidden>
              📞
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-foreground">{r.name}</p>
              {r.sub ? <p className="text-xs text-muted-foreground">{r.sub}</p> : null}
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {r.phone && r.dial !== false ? (
                  <PhoneLink phone={r.phone} className="text-sm" />
                ) : r.key === "911" ? (
                  <span className="inline-flex items-center gap-1.5 text-sm font-semibold tabular-nums text-foreground">
                    <span className="text-muted-foreground" aria-hidden>
                      📞
                    </span>
                    911 (dial on handset)
                  </span>
                ) : (
                  <span className="text-sm text-muted-foreground">{formatEmergencyTabPhone(r.phone)}</span>
                )}
                <span className="rounded-[6px] bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  24/7
                </span>
              </div>
            </div>
            <p className="w-full text-[11px] text-muted-foreground sm:w-40 sm:text-right">
              {formatEmergencyTabVerifyLine(r.verify)}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CallHistoryPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Sheet open={open} onOpenChange={(v) => !v && onClose()}>
      <SheetContent className="w-full sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Call history</SheetTitle>
        </SheetHeader>
        <p className="mt-4 text-sm text-muted-foreground">
          No call history on file. Telephony logging is tracked for a future release.
        </p>
      </SheetContent>
    </Sheet>
  );
}

function VerifyAllWalkthrough({
  open,
  onClose,
  contacts,
}: {
  open: boolean;
  onClose: () => void;
  contacts: { id: string; contact_name: string; phone_primary: string }[];
}) {
  const [idx, setIdx] = useState(0);

  const cur = contacts[idx];
  const isLast = contacts.length > 0 && idx >= contacts.length - 1;

  const finish = useCallback(() => {
    toast.success(`${contacts.length} contacts reviewed (verification timestamps require a schema update).`);
    onClose();
  }, [contacts.length, onClose]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Verify contacts</DialogTitle>
          <DialogDescription>
            Step {contacts.length === 0 ? 0 : idx + 1} of {contacts.length}. Confirm each line is still accurate for
            surveys and shift use.
          </DialogDescription>
        </DialogHeader>
        {cur ? (
          <div className="space-y-2 py-2">
            <p className="text-sm font-medium text-foreground">{cur.contact_name}</p>
            <PhoneLink phone={cur.phone_primary} />
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No contacts to verify.</p>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (contacts.length === 0) return;
              if (idx >= contacts.length - 1) return;
              setIdx((i) => i + 1);
            }}
            disabled={!cur || contacts.length === 0}
          >
            Skip
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              toast.message("Update flow — wire when edit API exists.");
            }}
            disabled={!cur}
          >
            Update
          </Button>
          <Button
            type="button"
            onClick={() => {
              if (contacts.length === 0) {
                onClose();
                return;
              }
              if (!cur) return;
              if (isLast) {
                finish();
                return;
              }
              setIdx((i) => i + 1);
            }}
            disabled={contacts.length > 0 && !cur}
          >
            {contacts.length === 0 ? "Close" : isLast ? "Complete" : "Verify ✓"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function EmergencyTab({
  facilityId,
  contactsApi,
  buildingFloors,
  hasElevator,
}: {
  facilityId: string;
  contactsApi: ContactsApi;
  buildingFloors: number;
  hasElevator: boolean;
}) {
  const { contacts, isLoading, error, createContact } = contactsApi;
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState("");
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifyWalkthroughKey, setVerifyWalkthroughKey] = useState(0);
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<EmergencyContactInput>({
    contact_category: "other",
    contact_name: "",
    phone_primary: "",
    sort_order: 0,
  });

  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const slotCtx: SlotContext = useMemo(
    () => ({ floorCount: buildingFloors, hasElevator }),
    [buildingFloors, hasElevator],
  );

  const filtered = useMemo(() => filterEmergencyContacts(contacts, search), [contacts, search]);

  const grouped = useMemo(() => {
    const map = new Map<ParentGroupId, typeof filtered>();
    for (const g of GROUP_ORDER) map.set(g, []);
    const unmapped: typeof filtered = [];
    for (const c of filtered) {
      const g = CATEGORY_GROUP[c.contact_category as ContactCategory];
      if (g && map.has(g)) {
        map.get(g)!.push(c);
      } else {
        unmapped.push(c);
      }
    }
    return { map, unmapped };
  }, [filtered]);

  const sheriff = useMemo(() => firstByCategory(contacts, ["law_enforcement"]), [contacts]);
  const fireAlarm = useMemo(() => firstByCategory(contacts, ["fire_alarm_monitoring"]), [contacts]);
  const hospital = useMemo(() => firstByCategory(contacts, ["hospital"]), [contacts]);

  const missingCount = countMissingEmergencySlots(contacts, slotCtx);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await createContact(form);
      setShowForm(false);
      setForm({
        contact_category: "other",
        contact_name: "",
        phone_primary: "",
        sort_order: 0,
        notes: undefined,
        address: undefined,
      });
      toast.success("Contact saved.");
    } catch (err) {
      console.error(err);
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-[8px] border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        {error}
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <p className="text-sm leading-relaxed text-muted-foreground">
        Quick-reference call list for fire, storm, medical, utility, and compliance emergencies. Verify quarterly. Post
        a printed copy at the nurses&apos; station. For single-report schedules use{" "}
        <Link href="/admin/reports/scheduled" className="font-medium text-primary underline-offset-4 hover:underline">
          Scheduled reports
        </Link>
        .
      </p>

      <EmergencyQuickStrip
        sheriff={sheriff}
        fireAlarm={fireAlarm}
        hospital={
          hospital
            ? {
                contact_name: hospital.contact_name,
                phone_primary: hospital.phone_primary,
                address: hospital.address,
              }
            : undefined
        }
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative min-w-0 flex-1 max-w-xl">
          <Label htmlFor="directory-search" className="sr-only">
            Search directory
          </Label>
          <Input
            id="directory-search"
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organization, person, phone, notes…"
            className="h-10"
          />
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              setVerifyWalkthroughKey((k) => k + 1);
              setVerifyOpen(true);
            }}
          >
            Verify all contacts
          </Button>
          <Link
            href={`/admin/facilities/${facilityId}/emergency-contacts/print`}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "inline-flex gap-1.5")}
          >
            <Printer className="h-4 w-4" aria-hidden />
            Print emergency list
          </Link>
          <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setShowForm((s) => !s)}>
            <Plus className="h-4 w-4" aria-hidden />
            Add contact
          </Button>
        </div>
      </div>

      {missingCount > 0 ? (
        <div
          id="emergency-required-gaps"
          className="rounded-[8px] border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-foreground"
        >
          <p className="font-medium">
            {missingCount} required catalog slot{missingCount === 1 ? "" : "s"} still open for AHCA-ready coverage.
          </p>
          <p className="mt-1 text-muted-foreground">
            Use <span className="font-medium text-foreground">Add contact</span> below to fill gaps. National hotlines
            are listed under Public safety.
          </p>
        </div>
      ) : null}

      {showForm && (
        <form onSubmit={handleSubmit} className="rounded-[8px] border border-border bg-muted/10 p-4 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-foreground">
              <FieldLabel className="mb-1 block">Category</FieldLabel>
              <select
                className={inputCls}
                value={form.contact_category}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    contact_category: e.target.value as EmergencyContactInput["contact_category"],
                  }))
                }
              >
                {CONTACT_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {CONTACT_CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-foreground">
              <FieldLabel className="mb-1 block">Organization / label</FieldLabel>
              <input
                className={inputCls}
                value={form.contact_name}
                onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))}
                required
              />
            </label>
            <label className="text-sm text-foreground">
              <FieldLabel className="mb-1 block">Primary phone</FieldLabel>
              <input
                className={inputCls}
                value={form.phone_primary}
                onChange={(e) => setForm((f) => ({ ...f, phone_primary: e.target.value }))}
                required
              />
            </label>
            <label className="text-sm text-foreground">
              <FieldLabel className="mb-1 block">Secondary phone</FieldLabel>
              <input
                className={inputCls}
                value={form.phone_secondary ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, phone_secondary: e.target.value || undefined }))}
              />
            </label>
            <label className="text-sm text-foreground sm:col-span-2">
              <FieldLabel className="mb-1 block">Address (optional)</FieldLabel>
              <input
                className={inputCls}
                value={form.address ?? ""}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value || undefined }))}
                placeholder="For hospitals, government offices…"
              />
            </label>
            <label className="text-sm text-foreground sm:col-span-2">
              <FieldLabel className="mb-1 block">Notes (max 500 chars)</FieldLabel>
              <textarea
                className={cn(inputCls, "min-h-[72px] resize-y")}
                value={form.notes ?? ""}
                maxLength={500}
                onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value || undefined }))}
              />
            </label>
          </div>
          <Button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save contact"}
          </Button>
        </form>
      )}

      {GROUP_ORDER.map((group) => {
        const list = grouped.map.get(group) ?? [];
        const showEmptyCTA = list.length === 0 && group !== "public_safety";

        return (
          <section key={group} className="space-y-2">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold tracking-tight text-foreground">
              <GroupHeaderIcon group={group} />
              {PARENT_GROUP_LABEL[group]}
            </h3>
            <div className="border-t border-border" />
            <ul className="divide-y divide-border">
              {group === "public_safety" ? (
                <>
                  <li className="flex min-h-[50px] flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">Poison Control</p>
                      <p className="text-[12px] text-muted-foreground">US hotline (National Poison Help)</p>
                    </div>
                    <PhoneLink phone={US_POISON} />
                    <span className="text-[11px] text-muted-foreground">24/7</span>
                    {verificationBadge()}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon" }),
                          "h-8 w-8 shrink-0",
                        )}
                        aria-label="Row actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => toast.message("Call history — not wired yet.")}>
                          Call history
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                  <li className="flex min-h-[50px] flex-wrap items-center gap-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-foreground">Adult Protective Services (FL)</p>
                      <p className="text-[12px] text-muted-foreground">Report abuse, neglect, exploitation (1-800-962-2873)</p>
                    </div>
                    <PhoneLink phone={FL_APS_PHONE} />
                    <span className="text-[11px] text-muted-foreground">24/7</span>
                    {verificationBadge()}
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        className={cn(
                          buttonVariants({ variant: "ghost", size: "icon" }),
                          "h-8 w-8 shrink-0",
                        )}
                        aria-label="Row actions"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => toast.message("Call history — not wired yet.")}>
                          Call history
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </li>
                </>
              ) : null}

              {showEmptyCTA ? (
                <li className="py-3 text-sm text-muted-foreground">
                  No contacts in this section yet.{" "}
                  <button
                    type="button"
                    className="font-medium text-primary underline-offset-4 hover:underline"
                    onClick={() => setShowForm(true)}
                  >
                    Add contact →
                  </button>
                </li>
              ) : (
                list.map((c) => {
                  const lines = formatContactDisplay(c.contact_name);
                  const isHospital = c.contact_category === "hospital";
                  return (
                    <li key={c.id} className="flex min-h-[50px] flex-wrap items-start gap-2 py-2 sm:items-center">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold text-foreground">{lines.org}</p>
                        {lines.subtitle ? (
                          <p className="text-[12px] text-muted-foreground">{lines.subtitle}</p>
                        ) : lines.metaTag ? (
                          <p className="text-[12px] text-muted-foreground">{lines.metaTag}</p>
                        ) : null}
                        <p className="text-[11px] text-muted-foreground">{categoryLabelForRow(c.contact_category)}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                          <PhoneLink phone={c.phone_primary} />
                          {c.phone_secondary ? <PhoneLink phone={c.phone_secondary} /> : null}
                          <span className="text-[11px] text-muted-foreground">
                            {formatEmergencyTabHoursLine(null)}
                          </span>
                        </div>
                        {c.notes ? (
                          <p className="mt-1 max-w-prose text-[12px] leading-snug text-muted-foreground">{c.notes}</p>
                        ) : null}
                        {c.address ? (
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-muted-foreground">
                            <span>{c.address}</span>
                            <DirectionsLink address={c.address} />
                          </p>
                        ) : null}
                        {isHospital && (c.distance_miles != null || c.drive_time_minutes != null) ? (
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            {c.distance_miles != null ? `${c.distance_miles} mi` : ""}
                            {c.distance_miles != null && c.drive_time_minutes != null ? " · " : ""}
                            {c.drive_time_minutes != null ? `~${c.drive_time_minutes} min` : ""}
                          </p>
                        ) : null}
                      </div>
                      {verificationBadge()}
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          className={cn(
                            buttonVariants({ variant: "ghost", size: "icon" }),
                            "h-8 w-8 shrink-0",
                          )}
                          aria-label="Row actions"
                        >
                          <MoreHorizontal className="h-4 w-4" />
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => toast.message("Edit — requires PATCH API.")}>Edit</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast.message("Verify — timestamps pending schema.")}>
                            Verify now
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast.message("Notes — use full edit when API lands.")}>
                            Add note
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toast.message("Delete — requires DELETE API.")}>
                            Delete
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onClick={() => setHistoryFor(c.id)}>View call history</DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </li>
                  );
                })
              )}
            </ul>
          </section>
        );
      })}

      {grouped.unmapped.length > 0 ? (
        <section className="space-y-2">
          <h3 className="text-[13px] font-semibold text-foreground">Other / ungrouped</h3>
          <div className="border-t border-border" />
          <ul className="divide-y divide-border">
            {grouped.unmapped.map((c) => (
              <li key={c.id} className="flex min-h-[50px] flex-wrap items-center gap-2 py-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground">{c.contact_name}</p>
                  <PhoneLink phone={c.phone_primary} />
                </div>
                {verificationBadge()}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <VerifyAllWalkthrough
        key={verifyWalkthroughKey}
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        contacts={contacts}
      />
      <CallHistoryPanel open={historyFor != null} onClose={() => setHistoryFor(null)} />
    </div>
  );
}
