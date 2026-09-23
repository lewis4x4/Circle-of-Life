"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { formatInTimeZone } from "date-fns-tz";
import { Building2, ChevronDown, Loader2, Lock, Settings, TriangleAlert } from "lucide-react";
import { toast } from "sonner";

import { digitsOnly, formatPhoneUsParenthetical } from "@/components/common/phone-link";
import { Button, buttonVariants } from "@/components/ui/button";
import { DateInput } from "@/components/ui/date-input";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useFacilityStore } from "@/hooks/useFacilityStore";
import { formatLiveDataLoadError } from "@/lib/live-data-fallback";
import { syncSelectedFacilityCookie } from "@/lib/facilities/selected-facility-cookie";
import {
  CLINICAL_LATER_COPY,
  CONTACT_METHOD_COPY,
  CONTACT_SAVE_FAILED_COPY,
  LEAD_SAVE_FAILED_COPY,
  OTHER_RELATIONSHIP,
  PREFERENCE_NOT_PERMISSION_COPY,
  PREFERENCE_OPTIONS,
  RELATIONSHIP_OPTIONS,
  buildCaptureInput,
  buildContactCommand,
  describeSaveError,
  emptyInquiryDraft,
  isInquiryDraftDirty,
  newRequestKey,
  saveButtonLabel,
  saveStatusLine,
  validateInquiryDraft,
  type InquiryDraft,
  type InquiryErrors,
  type InquiryField,
  type SaveProgress,
} from "@/lib/referrals/new-inquiry-model";
import {
  captureReferralEpisode,
  createAuthorizedReferralSource,
  runReferralEpisodeCommand,
} from "@/lib/referrals/referral-authority";
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

const SOURCE_GROUP_LABEL: Record<string, string> = {
  hospital: "Hospitals",
  agency: "Agencies",
  family: "Family and word of mouth",
  web: "Web",
  other: "Other",
};

const CREATE_SOURCE_SENTINEL = "__haven_create_referral_source__";
const UNKNOWN_SOURCE_SENTINEL = "__haven_source_not_yet_known__";

/** DOM ids, so an attempted save can move focus to the first problem. */
const FIELD_ID: Record<InquiryField, string> = {
  residentFirstName: "ref-resident-first",
  residentLastName: "ref-resident-last",
  residentIsContact: "ref-resident-is-contact",
  contactFirstName: "ref-contact-first",
  contactLastName: "ref-contact-last",
  relationship: "ref-relationship",
  relationshipOther: "ref-relationship-other",
  phone: "ref-phone",
  email: "ref-email",
  preference: "ref-preference-either",
  referralSourceId: "ref-source",
  sourceNotYetKnown: "ref-source-unknown",
  inquiryDate: "ref-inquiry-date",
  inquiryDateNotKnown: "ref-inquiry-date-unknown",
};

type SourceOption = { id: string; name: string; source_type: string };

function RequiredMark() {
  return (
    <>
      <span className="text-destructive" aria-hidden>
        {" "}
        *
      </span>
      <span className="sr-only"> (required)</span>
    </>
  );
}

function FieldError(props: { id: string; message: string | undefined; show: boolean }) {
  if (!props.show || !props.message) return null;
  return (
    <p id={props.id} className="text-[12px] text-destructive" role="alert">
      {props.message}
    </p>
  );
}

function SectionHeading(props: { id: string; title: string; description: string }) {
  return (
    <div className="space-y-0.5">
      <h2 id={props.id} className="text-base font-semibold text-foreground">
        {props.title}
      </h2>
      <p className="text-[13px] text-muted-foreground">{props.description}</p>
    </div>
  );
}

export default function AdminReferralsNewPage() {
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const selectedFacilityId = useFacilityStore((s) => s.selectedFacilityId);
  const availableFacilities = useFacilityStore((s) => s.availableFacilities);
  const setSelectedFacility = useFacilityStore((s) => s.setSelectedFacility);

  const [facilityTimezone, setFacilityTimezone] = useState<string>("America/New_York");

  // An empty inquiryDate means "today in the facility's day"; the draft only
  // carries a date once the operator changes it, so the default is not "work".
  const [draft, setDraft] = useState<InquiryDraft>(() => emptyInquiryDraft(""));
  const initialDraft = useMemo(() => emptyInquiryDraft(""), []);
  const [errors, setErrors] = useState<InquiryErrors>({});
  const [attempted, setAttempted] = useState(false);
  const [emailBlurred, setEmailBlurred] = useState(false);

  const [sources, setSources] = useState<SourceOption[]>([]);
  const [loadingSources, setLoadingSources] = useState(true);
  const [sourcesError, setSourcesError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [progress, setProgress] = useState<SaveProgress>({ step: "idle" });
  const [formError, setFormError] = useState<string | null>(null);
  // One request key per record per form session: a retry after a failure or a
  // double-click replays the same capture instead of creating a second lead.
  const leadRequestKeyRef = useRef(newRequestKey());
  const contactRequestKeyRef = useRef(newRequestKey());
  const savingRef = useRef(false);

  const [createSourceOpen, setCreateSourceOpen] = useState(false);
  const [newSourceName, setNewSourceName] = useState("");
  const [newSourceType, setNewSourceType] = useState<string>("hospital");
  const [newSourceFacilityOnly, setNewSourceFacilityOnly] = useState(false);
  const [creatingSource, setCreatingSource] = useState(false);
  const [sourceError, setSourceError] = useState<string | null>(null);

  const todayInFacility = useMemo(() => {
    try {
      return formatInTimeZone(new Date(), facilityTimezone, "yyyy-MM-dd");
    } catch {
      return formatInTimeZone(new Date(), "America/New_York", "yyyy-MM-dd");
    }
  }, [facilityTimezone]);
  const effectiveInquiryDate = draft.inquiryDate || todayInFacility;
  const draftForSave = useMemo<InquiryDraft>(
    () => ({ ...draft, inquiryDate: effectiveInquiryDate }),
    [draft, effectiveInquiryDate],
  );

  const leadSaved = progress.step === "lead_saved" || progress.step === "saving_contact" || progress.step === "done";
  const dirty = progress.step !== "done" && isInquiryDraftDirty(draft, initialDraft);
  const unsavedWork = dirty || (progress.step === "lead_saved" && progress.contactPending);
  const dirtyRef = useRef(false);
  useEffect(() => {
    dirtyRef.current = unsavedWork;
  }, [unsavedWork]);

  const currentFacilityName = useMemo(() => {
    if (!selectedFacilityId) return null;
    return availableFacilities.find((f) => f.id === selectedFacilityId)?.name ?? null;
  }, [availableFacilities, selectedFacilityId]);

  useEffect(() => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) return;
    let cancelled = false;
    void (async () => {
      const { data } = await supabase
        .from("facilities")
        .select("timezone")
        .eq("id", selectedFacilityId)
        .is("deleted_at", null)
        .maybeSingle();
      if (cancelled) return;
      const tz =
        data && typeof data === "object" && "timezone" in data && typeof (data as { timezone?: string }).timezone === "string"
          ? (data as { timezone: string }).timezone
          : "America/New_York";
      setFacilityTimezone(tz || "America/New_York");
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedFacilityId, supabase]);

  const loadSources = useCallback(async () => {
    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setSources([]);
      setLoadingSources(false);
      return;
    }
    setLoadingSources(true);
    setSourcesError(null);
    try {
      const { data, error: qErr } = await supabase
        .from("referral_sources")
        .select("id, name, source_type")
        .is("deleted_at", null)
        .eq("is_active", true)
        .or(`facility_id.is.null,facility_id.eq.${selectedFacilityId}`)
        .order("name");
      if (qErr) throw qErr;
      const next = (data ?? []) as SourceOption[];
      setSources(next);
      // A source chosen under another facility may not apply here; the choice is
      // cleared rather than silently saved against a source this facility cannot see.
      setDraft((prev) =>
        prev.referralSourceId && !next.some((s) => s.id === prev.referralSourceId)
          ? { ...prev, referralSourceId: "" }
          : prev,
      );
    } catch (err) {
      setSources([]);
      setSourcesError(formatLiveDataLoadError(err, "Referral sources are unavailable right now."));
    } finally {
      setLoadingSources(false);
    }
  }, [supabase, selectedFacilityId]);

  useEffect(() => {
    const pending = setTimeout(() => void loadSources(), 0);
    return () => clearTimeout(pending);
  }, [loadSources]);

  // Unsaved entries survive a facility change (the lead is not saved until the
  // operator saves it), but a reload — including "Reload to update" — asks first.
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (!dirtyRef.current && !savingRef.current) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);

  const handleFacilityScopeChange = useCallback(
    (facilityId: string | null) => {
      if (!setSelectedFacility(facilityId)) return;
      syncSelectedFacilityCookie(facilityId);
      router.refresh();
    },
    [router, setSelectedFacility],
  );

  const sourcesByType = useMemo(() => {
    const groups = new Map<string, SourceOption[]>();
    for (const source of sources) {
      const key = source.source_type || "other";
      groups.set(key, [...(groups.get(key) ?? []), source]);
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [sources]);

  function update<K extends InquiryField>(field: K, value: InquiryDraft[K]) {
    setDraft((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      const next = { ...prev };
      delete next[field];
      if (field === "phone" || field === "email") {
        delete next.phone;
        delete next.email;
        delete next.preference;
      }
      if (field === "residentIsContact" && value === true) {
        delete next.contactFirstName;
        delete next.contactLastName;
        delete next.relationship;
        delete next.relationshipOther;
      }
      if (field === "sourceNotYetKnown" && value === true) delete next.referralSourceId;
      if (field === "inquiryDateNotKnown" && value === true) delete next.inquiryDate;
      return next;
    });
    setFormError(null);
  }

  function focusField(field: InquiryField) {
    const element = document.getElementById(FIELD_ID[field]);
    if (element instanceof HTMLElement) element.focus();
  }

  async function handleCreateSource() {
    setSourceError(null);

    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setSourceError("Choose a saving facility before adding a source.");
      return;
    }

    const trimmedName = newSourceName.trim();
    if (!trimmedName) {
      setSourceError("Source name is required.");
      return;
    }

    setCreatingSource(true);
    try {
      const sourceId = await createAuthorizedReferralSource(supabase, {
        facilityId: selectedFacilityId,
        name: trimmedName,
        sourceType: newSourceType,
        facilityOnly: newSourceFacilityOnly,
      });

      await loadSources();
      setDraft((prev) => ({ ...prev, referralSourceId: sourceId, sourceNotYetKnown: false }));
      setErrors((prev) => ({ ...prev, referralSourceId: undefined }));
      setNewSourceName("");
      setNewSourceType("hospital");
      setNewSourceFacilityOnly(false);
      setCreateSourceOpen(false);
    } catch (err) {
      setSourceError(err instanceof Error ? err.message : "Could not create referral source.");
    } finally {
      setCreatingSource(false);
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (savingRef.current) return;
    setFormError(null);
    setAttempted(true);

    if (!selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId)) {
      setFormError("Choose a saving facility before saving.");
      return;
    }

    const validation = validateInquiryDraft(draftForSave);
    setErrors(validation.errors);
    if (validation.firstError) {
      focusField(validation.firstError);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    try {
      let leadId: string;
      let revision: string;
      if (progress.step === "lead_saved") {
        leadId = progress.leadId;
        revision = progress.revision;
      } else {
        setProgress({ step: "saving_lead" });
        const reply = await captureReferralEpisode(supabase, buildCaptureInput(draftForSave, selectedFacilityId, leadRequestKeyRef.current));
        leadId = reply.episode_id;
        revision = reply.episode_revision;
      }

      const contact = buildContactCommand(draftForSave);
      if (contact) {
        setProgress({ step: "saving_contact", leadId, revision });
        try {
          await runReferralEpisodeCommand(supabase, {
            episodeId: leadId,
            requestKey: contactRequestKeyRef.current,
            expectedRevision: revision,
            command: contact,
          });
        } catch (contactErr) {
          setProgress({ step: "lead_saved", leadId, revision, contactPending: true });
          setFormError(describeSaveError(contactErr, CONTACT_SAVE_FAILED_COPY));
          return;
        }
      }

      setProgress({ step: "done", leadId });
      dirtyRef.current = false;
      // A neutral toast: the shared success style fails contrast (green on pale green) and colour carries no meaning here.
      toast("Lead saved.", { duration: 5000 });
      router.push(`/admin/referrals/${leadId}`);
    } catch (err) {
      setProgress({ step: "idle" });
      setFormError(describeSaveError(err, LEAD_SAVE_FAILED_COPY));
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  function handleCancel(event: React.MouseEvent<HTMLAnchorElement>) {
    if (!dirtyRef.current) return;
    if (progress.step === "lead_saved" && progress.contactPending) {
      if (!window.confirm("Open the lead without recording the primary contact? You can add the contact from the lead later.")) {
        event.preventDefault();
      }
      return;
    }
    if (!window.confirm("Leave this page? The details you entered will not be saved.")) {
      event.preventDefault();
    }
  }

  const noFacility = !selectedFacilityId || !isValidFacilityIdForQuery(selectedFacilityId);
  const contactPending = progress.step === "lead_saved" && progress.contactPending;
  const leadFieldsLocked = leadSaved;
  const cancelHref = contactPending && progress.step === "lead_saved" ? `/admin/referrals/${progress.leadId}` : "/admin/referrals";
  const errorList = attempted ? (Object.keys(errors) as InquiryField[]).filter((field) => errors[field]) : [];
  const distinctErrorMessages = [...new Set(errorList.map((field) => errors[field] as string))];

  function onReferralSourceChange(value: string) {
    if (value === CREATE_SOURCE_SENTINEL) {
      setSourceError(null);
      setCreateSourceOpen(true);
      return;
    }
    if (value === UNKNOWN_SOURCE_SENTINEL) {
      setDraft((prev) => ({ ...prev, referralSourceId: "", sourceNotYetKnown: true }));
      setErrors((prev) => ({ ...prev, referralSourceId: undefined }));
      return;
    }
    setDraft((prev) => ({ ...prev, referralSourceId: value, sourceNotYetKnown: false }));
    setErrors((prev) => ({ ...prev, referralSourceId: undefined }));
  }

  const sourceSelectValue = draft.sourceNotYetKnown ? UNKNOWN_SOURCE_SENTINEL : draft.referralSourceId || undefined;

  return (
    <div className="mx-auto w-full max-w-[1000px] space-y-6 pb-12">
      <nav aria-label="Breadcrumb" className="text-[13px] text-muted-foreground">
        <ol className="flex flex-wrap items-center gap-1.5">
          <li>
            <Link href="/admin/referrals" className="text-primary underline-offset-4 hover:underline">
              Pipeline
            </Link>
          </li>
          <li aria-hidden>/</li>
          <li aria-current="page" className="text-foreground">
            New lead
          </li>
        </ol>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">New referral lead</h1>
          <p className="text-sm text-muted-foreground">Capture what is needed for a first follow-up.</p>
        </div>
        <Link
          href="/admin/referrals/sources"
          className={cn(buttonVariants({ variant: "outline", size: "sm" }), "gap-1.5")}
        >
          <Settings className="size-4" aria-hidden />
          Manage sources
        </Link>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-border bg-muted/20 px-4 py-2.5 text-sm">
        <span className="inline-flex items-center gap-2">
          <Building2 className="size-4 text-muted-foreground" aria-hidden />
          <span className="text-muted-foreground">Saving to</span>
          <span className="font-medium text-foreground">{currentFacilityName ?? "Not selected"}</span>
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger
            type="button"
            className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-8 gap-1 px-2.5 text-[13px]")}
          >
            Change facility
            <ChevronDown className="size-3.5 opacity-70" aria-hidden />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-[min(100vw-2rem,280px)] p-1">
            {availableFacilities.length === 0 ? (
              <div className="px-2 py-2 text-[12px] text-muted-foreground">No facilities available.</div>
            ) : (
              availableFacilities.map((facility) => (
                <DropdownMenuItem
                  key={facility.id}
                  className="cursor-pointer text-[13px]"
                  onClick={() => handleFacilityScopeChange(facility.id)}
                >
                  {facility.name}
                </DropdownMenuItem>
              ))
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {noFacility ? (
        <p
          className="flex items-start gap-2 rounded-[8px] border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] text-foreground"
          role="status"
        >
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
          <span>
            Choose a saving facility using Change facility above (or the facility menu in the header). Anything you have
            entered stays on this page.
          </span>
        </p>
      ) : (
        <form onSubmit={(e) => void handleSubmit(e)} noValidate className="space-y-6">
          {attempted && distinctErrorMessages.length > 0 ? (
            <div
              role="alert"
              className="rounded-[8px] border border-warning/30 bg-warning/10 px-4 py-3 text-[13px] text-foreground"
            >
              <p className="font-medium">
                {distinctErrorMessages.length === 1 ? "One thing to fix before saving:" : `${distinctErrorMessages.length} things to fix before saving:`}
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {distinctErrorMessages.map((message) => (
                  <li key={message}>{message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="divide-y divide-border rounded-[8px] border border-border bg-card">
            <section aria-labelledby="resident-heading" className="space-y-4 p-5">
              <SectionHeading id="resident-heading" title="Prospective resident" description="The person who would move in." />
              {leadFieldsLocked && progress.step !== "done" ? (
                <p className="text-[13px] text-muted-foreground" role="status">
                  Saved as a lead.{" "}
                  {progress.step === "lead_saved" || progress.step === "saving_contact" ? (
                    <Link href={`/admin/referrals/${progress.leadId}`} className="text-primary underline-offset-4 hover:underline">
                      Open lead
                    </Link>
                  ) : null}
                </p>
              ) : null}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={FIELD_ID.residentFirstName} className="text-[13px]">
                    First name
                    <RequiredMark />
                  </Label>
                  <Input
                    id={FIELD_ID.residentFirstName}
                    value={draft.residentFirstName}
                    onChange={(e) => update("residentFirstName", e.target.value)}
                    autoComplete="off"
                    disabled={leadFieldsLocked}
                    aria-required
                    aria-invalid={attempted && !!errors.residentFirstName}
                    aria-describedby={attempted && errors.residentFirstName ? `${FIELD_ID.residentFirstName}-err` : undefined}
                  />
                  <FieldError id={`${FIELD_ID.residentFirstName}-err`} message={errors.residentFirstName} show={attempted} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={FIELD_ID.residentLastName} className="text-[13px]">
                    Last name
                    <RequiredMark />
                  </Label>
                  <Input
                    id={FIELD_ID.residentLastName}
                    value={draft.residentLastName}
                    onChange={(e) => update("residentLastName", e.target.value)}
                    autoComplete="off"
                    disabled={leadFieldsLocked}
                    aria-required
                    aria-invalid={attempted && !!errors.residentLastName}
                    aria-describedby={attempted && errors.residentLastName ? `${FIELD_ID.residentLastName}-err` : undefined}
                  />
                  <FieldError id={`${FIELD_ID.residentLastName}-err`} message={errors.residentLastName} show={attempted} />
                </div>
              </div>
              <p className="text-[12px] text-muted-foreground">
                A lead needs the prospective resident&apos;s name. If it is not known yet, keep the inquiry in your notes
                until it is, rather than entering a placeholder.
              </p>
            </section>

            <section aria-labelledby="contact-heading" className="space-y-4 p-5">
              <SectionHeading id="contact-heading" title="Primary contact" description="Who should we contact about this inquiry?" />
              <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                <input
                  id={FIELD_ID.residentIsContact}
                  type="checkbox"
                  checked={draft.residentIsContact}
                  disabled={leadFieldsLocked}
                  onChange={(e) => update("residentIsContact", e.target.checked)}
                  className="size-4 accent-primary"
                />
                The prospective resident is the primary contact
              </label>

              {!draft.residentIsContact ? (
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={FIELD_ID.contactFirstName} className="text-[13px]">
                      Contact first name
                      <RequiredMark />
                    </Label>
                    <Input
                      id={FIELD_ID.contactFirstName}
                      value={draft.contactFirstName}
                      onChange={(e) => update("contactFirstName", e.target.value)}
                      autoComplete="off"
                      aria-required
                      aria-invalid={attempted && !!errors.contactFirstName}
                      aria-describedby={attempted && errors.contactFirstName ? `${FIELD_ID.contactFirstName}-err` : undefined}
                    />
                    <FieldError id={`${FIELD_ID.contactFirstName}-err`} message={errors.contactFirstName} show={attempted} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={FIELD_ID.contactLastName} className="text-[13px]">
                      Contact last name
                      <RequiredMark />
                    </Label>
                    <Input
                      id={FIELD_ID.contactLastName}
                      value={draft.contactLastName}
                      onChange={(e) => update("contactLastName", e.target.value)}
                      autoComplete="off"
                      aria-required
                      aria-invalid={attempted && !!errors.contactLastName}
                      aria-describedby={attempted && errors.contactLastName ? `${FIELD_ID.contactLastName}-err` : undefined}
                    />
                    <FieldError id={`${FIELD_ID.contactLastName}-err`} message={errors.contactLastName} show={attempted} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={FIELD_ID.relationship} className="text-[13px]">
                      Relationship to the prospective resident
                      <RequiredMark />
                    </Label>
                    <Select value={draft.relationship || undefined} onValueChange={(v) => update("relationship", v)}>
                      <SelectTrigger
                        id={FIELD_ID.relationship}
                        aria-required
                        aria-invalid={attempted && !!errors.relationship}
                        aria-describedby={attempted && errors.relationship ? `${FIELD_ID.relationship}-err` : undefined}
                      >
                        <SelectValue placeholder="Select relationship" />
                      </SelectTrigger>
                      <SelectContent position="popper">
                        {RELATIONSHIP_OPTIONS.map((option) => (
                          <SelectItem key={option} value={option}>
                            {option}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FieldError id={`${FIELD_ID.relationship}-err`} message={errors.relationship} show={attempted} />
                  </div>
                  {draft.relationship === OTHER_RELATIONSHIP ? (
                    <div className="space-y-2">
                      <Label htmlFor={FIELD_ID.relationshipOther} className="text-[13px]">
                        Describe the relationship
                        <RequiredMark />
                      </Label>
                      <Input
                        id={FIELD_ID.relationshipOther}
                        value={draft.relationshipOther}
                        onChange={(e) => update("relationshipOther", e.target.value)}
                        aria-required
                        aria-invalid={attempted && !!errors.relationshipOther}
                        aria-describedby={attempted && errors.relationshipOther ? `${FIELD_ID.relationshipOther}-err` : undefined}
                      />
                      <FieldError id={`${FIELD_ID.relationshipOther}-err`} message={errors.relationshipOther} show={attempted} />
                    </div>
                  ) : null}
                </div>
              ) : null}

              <div className="space-y-3" role="group" aria-labelledby="contact-methods-label" aria-describedby="contact-method-hint">
                <p id="contact-methods-label" className="sr-only">
                  {draft.residentIsContact ? "The prospective resident's phone and email" : "The contact's phone and email"}
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor={FIELD_ID.phone} className="text-[13px]">
                      Phone
                    </Label>
                    <Input
                      id={FIELD_ID.phone}
                      value={draft.phone}
                      placeholder="(555) 123-4567"
                      disabled={leadFieldsLocked && draft.residentIsContact}
                      onChange={(e) => update("phone", e.target.value)}
                      onBlur={() => {
                        const d = digitsOnly(draft.phone);
                        if (d.length === 10 || (d.length === 11 && d.startsWith("1"))) {
                          update("phone", formatPhoneUsParenthetical(draft.phone));
                        }
                      }}
                      type="tel"
                      autoComplete="off"
                      aria-invalid={attempted && !!errors.phone}
                      aria-describedby={["contact-method-hint", attempted && errors.phone ? `${FIELD_ID.phone}-err` : ""].filter(Boolean).join(" ")}
                    />
                    <FieldError id={`${FIELD_ID.phone}-err`} message={errors.phone} show={attempted} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor={FIELD_ID.email} className="text-[13px]">
                      Email
                    </Label>
                    <Input
                      id={FIELD_ID.email}
                      value={draft.email}
                      placeholder="name@example.com"
                      disabled={leadFieldsLocked && draft.residentIsContact}
                      onChange={(e) => update("email", e.target.value)}
                      onBlur={() => {
                        setEmailBlurred(true);
                        const { errors: next } = validateInquiryDraft(draftForSave);
                        if (next.email === "Enter a valid email address.") {
                          setErrors((prev) => ({ ...prev, email: next.email }));
                        }
                      }}
                      type="email"
                      autoComplete="off"
                      aria-invalid={(attempted || emailBlurred) && !!errors.email}
                      aria-describedby={["contact-method-hint", (attempted || emailBlurred) && errors.email ? `${FIELD_ID.email}-err` : ""].filter(Boolean).join(" ")}
                    />
                    <FieldError id={`${FIELD_ID.email}-err`} message={errors.email} show={attempted || emailBlurred} />
                  </div>
                </div>
                <p id="contact-method-hint" className="text-[12px] text-muted-foreground">
                  {CONTACT_METHOD_COPY}
                </p>
              </div>

              <fieldset className="space-y-2 border-0 p-0" aria-describedby="preference-hint">
                <legend className="mb-2 text-[13px] font-medium text-foreground">Contact preference</legend>
                <div className="flex flex-wrap gap-6">
                  {PREFERENCE_OPTIONS.map((option) => (
                    <label key={option.value} className="flex cursor-pointer items-center gap-2 text-[13px]">
                      <input
                        id={`ref-preference-${option.value}`}
                        type="radio"
                        name="preferred-contact"
                        checked={draft.preference === option.value}
                        disabled={leadFieldsLocked}
                        onChange={() => update("preference", option.value)}
                        aria-describedby={attempted && errors.preference ? "ref-preference-err" : undefined}
                        className="size-4 accent-primary"
                      />
                      {option.label}
                    </label>
                  ))}
                </div>
                <FieldError id="ref-preference-err" message={errors.preference} show={attempted} />
                <p id="preference-hint" className="text-[12px] text-muted-foreground">
                  {PREFERENCE_NOT_PERMISSION_COPY}
                </p>
              </fieldset>
            </section>

            <section aria-labelledby="referral-heading" className="space-y-4 p-5">
              <SectionHeading id="referral-heading" title="Referral details" description="Where the inquiry came from and when." />
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={FIELD_ID.referralSourceId} className="text-[13px]">
                    Referral source
                    <RequiredMark />
                  </Label>
                  <Select value={sourceSelectValue} onValueChange={onReferralSourceChange} disabled={loadingSources || leadFieldsLocked}>
                    <SelectTrigger
                      id={FIELD_ID.referralSourceId}
                      aria-required
                      aria-invalid={attempted && !!errors.referralSourceId}
                      aria-describedby={["ref-source-hint", attempted && errors.referralSourceId ? `${FIELD_ID.referralSourceId}-err` : ""].filter(Boolean).join(" ")}
                    >
                      <SelectValue placeholder={loadingSources ? "Loading sources…" : "Select a source"} />
                    </SelectTrigger>
                    <SelectContent position="popper">
                      {sourcesByType.map(([type, group]) => (
                        <SelectGroup key={type}>
                          <SelectLabel>{SOURCE_GROUP_LABEL[type] ?? type}</SelectLabel>
                          {group.map((s) => (
                            <SelectItem key={s.id} value={s.id}>
                              {s.name}
                            </SelectItem>
                          ))}
                        </SelectGroup>
                      ))}
                      {sources.length > 0 ? <SelectSeparator /> : null}
                      <SelectItem value={UNKNOWN_SOURCE_SENTINEL}>Source not yet known</SelectItem>
                      <SelectItem value={CREATE_SOURCE_SENTINEL} className="text-primary">
                        + Create new source
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <p id="ref-source-hint" className="text-[12px] text-muted-foreground">
                    Choose &ldquo;Source not yet known&rdquo; if it is unconfirmed rather than guessing.
                  </p>
                  {sourcesError ? (
                    <p className="text-[12px] text-destructive" role="alert">
                      {sourcesError}
                    </p>
                  ) : null}
                  <FieldError id={`${FIELD_ID.referralSourceId}-err`} message={errors.referralSourceId} show={attempted} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={FIELD_ID.inquiryDate} className="text-[13px]">
                    Inquiry date
                  </Label>
                  <DateInput
                    id={FIELD_ID.inquiryDate}
                    value={draft.inquiryDateNotKnown ? "" : effectiveInquiryDate}
                    onValueChange={(value) => update("inquiryDate", value)}
                    emptyHint={null}
                    className={cn("h-9 max-w-[11.5rem] text-[13px]", draft.inquiryDateNotKnown && "opacity-60")}
                  />
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
                    <input
                      id={FIELD_ID.inquiryDateNotKnown}
                      type="checkbox"
                      checked={draft.inquiryDateNotKnown}
                      disabled={leadFieldsLocked}
                      onChange={(e) => update("inquiryDateNotKnown", e.target.checked)}
                      className="size-4 accent-primary"
                    />
                    Date not known
                  </label>
                  <FieldError id={`${FIELD_ID.inquiryDate}-err`} message={errors.inquiryDate} show={attempted} />
                </div>
              </div>

              <p className="flex items-start gap-2 rounded-[8px] border border-border bg-muted/20 px-4 py-3 text-[13px] text-muted-foreground">
                <Lock className="mt-0.5 size-4 shrink-0" aria-hidden />
                {CLINICAL_LATER_COPY}
              </p>
            </section>

            <div className="flex flex-wrap items-center justify-between gap-3 p-5">
              <div className="min-w-0 text-[13px]">
                {formError ? (
                  <p className="inline-flex items-start gap-2 text-destructive" role="alert">
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    {formError}
                  </p>
                ) : (
                  <p className="text-muted-foreground" aria-live="polite">
                    {saveStatusLine(progress, dirty)}
                  </p>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Link
                  href={cancelHref}
                  onClick={handleCancel}
                  className={cn(buttonVariants({ variant: "outline" }))}
                >
                  {contactPending ? "Open lead without contact" : "Cancel"}
                </Link>
                <Button type="submit" disabled={saving} aria-busy={saving} className="min-w-[140px]">
                  {saving ? <Loader2 className="mr-2 size-4 animate-spin" aria-hidden /> : null}
                  {saveButtonLabel(progress, saving)}
                </Button>
              </div>
            </div>
          </div>
        </form>
      )}

      <Dialog open={createSourceOpen} onOpenChange={setCreateSourceOpen}>
        <DialogContent className="bg-card sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create referral source</DialogTitle>
            <DialogDescription>Add a source for this organization. It will be selected on the lead form.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="modal-new-source-name">Source name</Label>
              <Input
                id="modal-new-source-name"
                value={newSourceName}
                onChange={(e) => setNewSourceName(e.target.value)}
                placeholder="Hospital, agency, website…"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="modal-new-source-type">Type</Label>
              <Select value={newSourceType} onValueChange={setNewSourceType}>
                <SelectTrigger id="modal-new-source-type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SOURCE_TYPES.map((type) => (
                    <SelectItem key={type.value} value={type.value}>
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-[13px] text-foreground">
              <input
                type="checkbox"
                checked={newSourceFacilityOnly}
                onChange={(e) => setNewSourceFacilityOnly(e.target.checked)}
                className="size-4 accent-primary"
              />
              Only use this source for the current saving facility
            </label>
            {sourceError ? (
              <p className="text-[13px] text-destructive" role="alert">
                {sourceError}
              </p>
            ) : null}
          </div>
          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setCreateSourceOpen(false);
                setSourceError(null);
              }}
            >
              Cancel
            </Button>
            <Button type="button" size="sm" disabled={creatingSource} onClick={() => void handleCreateSource()}>
              {creatingSource ? (
                <>
                  <Loader2 className="mr-2 size-4 animate-spin" aria-hidden />
                  Saving…
                </>
              ) : (
                "Save source"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
