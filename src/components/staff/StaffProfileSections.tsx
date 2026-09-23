"use client";

import React, { useState } from "react";
import { Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DetailRow, RecordDetailSection } from "@/design-system/components/record-detail";
import {
  buildStaffProfileSectionPatch,
  staffProfileDraftFromRow,
  staffProfileEmploymentStatusOptions,
  type StaffProfileDraft,
  type StaffProfileRow,
  type StaffProfileSection,
} from "@/lib/staff/staff-profile-edit";
import {
  formatStaffDetailAltPhone,
  formatStaffDetailEmail,
  formatStaffDetailEmergencyName,
  formatStaffDetailEmergencyPhone,
  formatStaffDetailEmergencyRelationship,
  formatStaffDetailHireDate,
  formatStaffDetailMaxHours,
  formatStaffDetailPhone,
  formatStaffDetailRateCents,
  formatStaffDetailTerminationDate,
} from "@/lib/staff/staff-detail-display-copy";
import { enumLabel } from "@/lib/display/enum-label";

const FIELD_LABEL = "text-xs font-medium text-muted-foreground";

export type StaffProfileSectionsProps = {
  staff: StaffProfileRow;
  canEdit: boolean;
  updatedBy: string;
  onStaffUpdated: (staff: StaffProfileRow) => void;
  onSaveSection: (
    section: StaffProfileSection,
    draft: StaffProfileDraft,
  ) => Promise<{ staff?: StaffProfileRow; error?: string }>;
};

type EditableRecordSectionProps = {
  title: string;
  className?: string;
  section: StaffProfileSection;
  staff: StaffProfileRow;
  canEdit: boolean;
  editingSection: StaffProfileSection | null;
  setEditingSection: (section: StaffProfileSection | null) => void;
  draft: StaffProfileDraft;
  setDraft: React.Dispatch<React.SetStateAction<StaffProfileDraft>>;
  updatedBy: string;
  currentStatus: string;
  onSaveSection: StaffProfileSectionsProps["onSaveSection"];
  onStaffUpdated: (row: StaffProfileRow) => void;
  view: React.ReactNode;
  edit: React.ReactNode;
};

function EditableRecordSection({
  title,
  className,
  section,
  staff,
  canEdit,
  editingSection,
  setEditingSection,
  draft,
  setDraft,
  updatedBy,
  currentStatus,
  onSaveSection,
  onStaffUpdated,
  view,
  edit,
}: EditableRecordSectionProps) {
  const editing = editingSection === section;
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const startEdit = () => {
    setError(null);
    setEditingSection(section);
  };

  const cancel = () => {
    setError(null);
    setDraft(staffProfileDraftFromRow(staff));
    setEditingSection(null);
  };

  const save = async () => {
    const built = buildStaffProfileSectionPatch(section, draft, updatedBy, currentStatus);
    if (!built.ok) {
      setError(built.error);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await onSaveSection(section, draft);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (result.staff) {
        onStaffUpdated(result.staff);
        setDraft(staffProfileDraftFromRow(result.staff));
      }
      setEditingSection(null);
    } finally {
      setSaving(false);
    }
  };

  const action =
    canEdit && editingSection === null ? (
      <Button type="button" variant="ghost" size="sm" onClick={startEdit}>
        Edit
      </Button>
    ) : editing ? (
      <div className="flex items-center gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={saving}>
          Cancel
        </Button>
        <Button type="button" size="sm" onClick={() => void save()} disabled={saving}>
          {saving ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save"
          )}
        </Button>
      </div>
    ) : null;

  return (
    <RecordDetailSection title={title} className={className} action={action}>
      {error ? (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}
      {editing ? edit : view}
    </RecordDetailSection>
  );
}

export function StaffProfileSections({
  staff,
  canEdit,
  updatedBy,
  onStaffUpdated,
  onSaveSection,
}: StaffProfileSectionsProps) {
  const [editingSection, setEditingSection] = useState<StaffProfileSection | null>(null);
  const [draft, setDraft] = useState<StaffProfileDraft>(() => staffProfileDraftFromRow(staff));

  const addressLine = [staff.address_line_1, staff.address_line_2].filter(Boolean).join(", ");
  const cityState = [staff.city, staff.state].filter(Boolean).join(", ");
  const addrRest = [cityState, staff.zip].filter(Boolean).join(" ");

  const employmentOptions = staffProfileEmploymentStatusOptions(staff.employment_status);

  const sectionProps = {
    staff,
    canEdit,
    editingSection,
    setEditingSection,
    draft,
    setDraft,
    updatedBy,
    currentStatus: staff.employment_status,
    onSaveSection,
    onStaffUpdated,
  };

  return (
    <>
      <EditableRecordSection
        {...sectionProps}
        section="name"
        title="Name"
        view={
          <div className="space-y-4 text-sm">
            <DetailRow label="First name" value={staff.first_name} />
            <DetailRow label="Last name" value={staff.last_name} />
            <DetailRow
              label="Preferred name"
              value={staff.preferred_name?.trim() ? staff.preferred_name : "—"}
            />
          </div>
        }
        edit={
          <div className="space-y-4 max-w-xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="staff-profile-first-name" className={FIELD_LABEL}>First name</label>
                <Input id="staff-profile-first-name"
                  value={draft.first_name}
                  onChange={(e) => setDraft((d) => ({ ...d, first_name: e.target.value }))}
                  required
                  autoComplete="given-name"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="staff-profile-last-name" className={FIELD_LABEL}>Last name</label>
                <Input id="staff-profile-last-name"
                  value={draft.last_name}
                  onChange={(e) => setDraft((d) => ({ ...d, last_name: e.target.value }))}
                  required
                  autoComplete="family-name"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-preferred-name-optional" className={FIELD_LABEL}>Preferred name (optional)</label>
              <Input id="staff-profile-preferred-name-optional"
                value={draft.preferred_name}
                onChange={(e) => setDraft((d) => ({ ...d, preferred_name: e.target.value }))}
              />
            </div>
          </div>
        }
      />

      <EditableRecordSection
        {...sectionProps}
        section="contact"
        title="Contact"
        view={
          <div className="space-y-4 text-sm">
            <DetailRow label="Phone" value={formatStaffDetailPhone(staff.phone)} />
            <DetailRow label="Alt phone" value={formatStaffDetailAltPhone(staff.phone_alt)} />
            <DetailRow
              label="Email"
              value={
                staff.email?.trim() ? (
                  <a
                    href={`mailto:${staff.email}`}
                    className="inline-flex items-center gap-1.5 font-medium underline-offset-4 hover:underline"
                  >
                    <Mail className="h-3.5 w-3.5" />
                    {staff.email}
                  </a>
                ) : (
                  <span className="text-muted-foreground">{formatStaffDetailEmail(staff.email)}</span>
                )
              }
            />
          </div>
        }
        edit={
          <div className="space-y-4 max-w-xl">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="staff-profile-phone" className={FIELD_LABEL}>Phone</label>
                <Input id="staff-profile-phone"
                  type="tel"
                  value={draft.phone}
                  onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))}
                  autoComplete="tel"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="staff-profile-alt-phone" className={FIELD_LABEL}>Alt phone</label>
                <Input id="staff-profile-alt-phone"
                  type="tel"
                  value={draft.phone_alt}
                  onChange={(e) => setDraft((d) => ({ ...d, phone_alt: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-email" className={FIELD_LABEL}>Email</label>
              <Input id="staff-profile-email"
                type="email"
                value={draft.email}
                onChange={(e) => setDraft((d) => ({ ...d, email: e.target.value }))}
                autoComplete="email"
              />
            </div>
          </div>
        }
      />

      <EditableRecordSection
        {...sectionProps}
        section="emergency"
        title="Emergency contact"
        view={
          <div className="space-y-4 text-sm">
            <DetailRow label="Name" value={formatStaffDetailEmergencyName(staff.emergency_contact_name)} />
            <DetailRow
              label="Relationship"
              value={formatStaffDetailEmergencyRelationship(staff.emergency_contact_relationship)}
            />
            <DetailRow label="Phone" value={formatStaffDetailEmergencyPhone(staff.emergency_contact_phone)} />
          </div>
        }
        edit={
          <div className="space-y-4 max-w-xl">
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-name" className={FIELD_LABEL}>Name</label>
              <Input id="staff-profile-name"
                value={draft.emergency_contact_name}
                onChange={(e) => setDraft((d) => ({ ...d, emergency_contact_name: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-relationship" className={FIELD_LABEL}>Relationship</label>
              <Input id="staff-profile-relationship"
                value={draft.emergency_contact_relationship}
                onChange={(e) =>
                  setDraft((d) => ({ ...d, emergency_contact_relationship: e.target.value }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-phone-2" className={FIELD_LABEL}>Phone</label>
              <Input id="staff-profile-phone-2"
                type="tel"
                value={draft.emergency_contact_phone}
                onChange={(e) => setDraft((d) => ({ ...d, emergency_contact_phone: e.target.value }))}
              />
            </div>
          </div>
        }
      />

      <EditableRecordSection
        {...sectionProps}
        section="address"
        title="Address"
        className="lg:col-span-2"
        view={
          <div className="text-sm">
            {!addressLine && !addrRest ? (
              <p className="text-muted-foreground">No address on file.</p>
            ) : (
              <p className="whitespace-pre-line leading-relaxed font-medium text-foreground">
                {[addressLine, addrRest].filter(Boolean).join("\n")}
              </p>
            )}
          </div>
        }
        edit={
          <div className="grid gap-4 max-w-xl sm:grid-cols-2">
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="staff-profile-address-line-1" className={FIELD_LABEL}>Address line 1</label>
              <Input id="staff-profile-address-line-1"
                value={draft.address_line_1}
                onChange={(e) => setDraft((d) => ({ ...d, address_line_1: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <label htmlFor="staff-profile-address-line-2" className={FIELD_LABEL}>Address line 2</label>
              <Input id="staff-profile-address-line-2"
                value={draft.address_line_2}
                onChange={(e) => setDraft((d) => ({ ...d, address_line_2: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-city" className={FIELD_LABEL}>City</label>
              <Input id="staff-profile-city" value={draft.city} onChange={(e) => setDraft((d) => ({ ...d, city: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-state" className={FIELD_LABEL}>State</label>
              <Input id="staff-profile-state" value={draft.state} onChange={(e) => setDraft((d) => ({ ...d, state: e.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-zip" className={FIELD_LABEL}>ZIP</label>
              <Input id="staff-profile-zip" value={draft.zip} onChange={(e) => setDraft((d) => ({ ...d, zip: e.target.value }))} />
            </div>
          </div>
        }
      />

      <EditableRecordSection
        {...sectionProps}
        section="employment"
        title="Employment"
        view={
          <div className="space-y-4 text-sm">
            <DetailRow label="Hire date" value={formatStaffDetailHireDate(staff.hire_date)} />
            <DetailRow label="Status" value={enumLabel(staff.employment_status)} />
            {staff.termination_date ? (
              <DetailRow
                label="Termination"
                value={formatStaffDetailTerminationDate(staff.termination_date)}
              />
            ) : null}
            {staff.termination_reason ? (
              <DetailRow label="Termination reason" value={staff.termination_reason} />
            ) : null}
            <DetailRow label="Schedule" value={staff.is_full_time ? "Full time" : "Part time"} />
            <DetailRow label="Float pool" value={staff.is_float_pool ? "Yes" : "No"} />
            <DetailRow label="Max hrs / week" value={formatStaffDetailMaxHours(staff.max_hours_per_week)} />
          </div>
        }
        edit={
          <div className="space-y-4 max-w-xl">
            <div className="space-y-1.5">
              <label className={FIELD_LABEL} htmlFor="staff-profile-hire-date">
                Hire date (ET)
              </label>
              <Input
                id="staff-profile-hire-date"
                type="date"
                value={draft.hire_date}
                onChange={(e) => setDraft((d) => ({ ...d, hire_date: e.target.value }))}
                required
                aria-label="Hire date (Eastern Time)"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-employment-status" className={FIELD_LABEL}>Employment status</label>
              <select id="staff-profile-employment-status"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={draft.employment_status}
                onChange={(e) => setDraft((d) => ({ ...d, employment_status: e.target.value }))}
              >
                {employmentOptions.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="staff-profile-termination-date" className={FIELD_LABEL}>Termination date</label>
                <Input id="staff-profile-termination-date"
                  type="date"
                  value={draft.termination_date}
                  onChange={(e) => setDraft((d) => ({ ...d, termination_date: e.target.value }))}
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="staff-profile-max-hrs-week" className={FIELD_LABEL}>Max hrs / week</label>
                <Input id="staff-profile-max-hrs-week"
                  inputMode="decimal"
                  value={draft.max_hours_per_week}
                  onChange={(e) => setDraft((d) => ({ ...d, max_hours_per_week: e.target.value }))}
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-termination-reason" className={FIELD_LABEL}>Termination reason</label>
              <Input id="staff-profile-termination-reason"
                value={draft.termination_reason}
                onChange={(e) => setDraft((d) => ({ ...d, termination_reason: e.target.value }))}
              />
            </div>
            <div className="flex flex-wrap gap-6">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.is_full_time}
                  onChange={(e) => setDraft((d) => ({ ...d, is_full_time: e.target.checked }))}
                />
                Full time
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.is_float_pool}
                  onChange={(e) => setDraft((d) => ({ ...d, is_float_pool: e.target.checked }))}
                />
                Float pool
              </label>
            </div>
          </div>
        }
      />

      <EditableRecordSection
        {...sectionProps}
        section="compensation"
        title="Compensation"
        view={
          <div className="space-y-4 text-sm">
            <DetailRow
              label="Base hourly"
              value={
                <span className="tabular-nums text-lg font-medium">
                  {formatStaffDetailRateCents(staff.hourly_rate)}
                </span>
              }
            />
            <DetailRow
              label="Overtime"
              value={
                <span className="tabular-nums text-lg font-medium">
                  {formatStaffDetailRateCents(staff.overtime_rate)}
                </span>
              }
            />
          </div>
        }
        edit={
          <div className="grid gap-4 max-w-xl sm:grid-cols-2">
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-base-hourly" className={FIELD_LABEL}>Base hourly ($)</label>
              <Input id="staff-profile-base-hourly"
                inputMode="decimal"
                value={draft.hourly_rate_dollars}
                onChange={(e) => setDraft((d) => ({ ...d, hourly_rate_dollars: e.target.value }))}
                placeholder="0.00"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="staff-profile-overtime" className={FIELD_LABEL}>Overtime ($)</label>
              <Input id="staff-profile-overtime"
                inputMode="decimal"
                value={draft.overtime_rate_dollars}
                onChange={(e) => setDraft((d) => ({ ...d, overtime_rate_dollars: e.target.value }))}
                placeholder="0.00"
              />
            </div>
          </div>
        }
      />
    </>
  );
}
