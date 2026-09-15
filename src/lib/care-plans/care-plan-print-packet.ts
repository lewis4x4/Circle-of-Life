/**
 * Print packet for one care plan: everything the printed page needs, already
 * grouped and named, so the page renders and the route decides access.
 * Built from raw rows here so the shaping is testable without Supabase.
 */

import { medicationSystemOfRecordFromSettings, type MedicationSystemOfRecord } from "@/lib/admin/facilities/medication-system-of-record";

import { formatCarePlanResidentName } from "./care-plan-display-copy";
import { formatCarePlanPrintCategoryLabel, formatCarePlanPrintRoom } from "./care-plan-print-copy";

export type CarePlanPrintItem = {
  id: string;
  title: string | null;
  description: string | null;
  assistanceLevel: string | null;
  frequency: string | null;
  goal: string | null;
  interventions: string[];
  specialInstructions: string | null;
};

export type CarePlanPrintSection = {
  category: string;
  label: string;
  items: CarePlanPrintItem[];
};

export type CarePlanPrintSignature = {
  approvedAt: string;
  approverName: string | null;
  /** Data URL captured by `SignaturePad` at approval; null when the plan was approved without one. */
  signatureData: string | null;
};

export type CarePlanPrintAcknowledgement = {
  id: string;
  signerRole: string;
  signerName: string;
  relationship: string | null;
  method: string;
  signatureData: string | null;
  acknowledgedAt: string;
};

export type CarePlanPrintAcknowledgementRow = {
  id: string;
  signer_role: string;
  signer_name: string;
  relationship_to_resident: string | null;
  method: string;
  signature_data: string | null;
  acknowledged_at: string;
};

export type CarePlanPrintPacket = {
  plan: {
    id: string;
    version: number | null;
    status: string;
    effectiveDate: string | null;
    reviewDueDate: string | null;
    notes: string | null;
    supersededByVersion: number | null;
  };
  resident: {
    id: string;
    name: string;
    dateOfBirth: string | null;
    room: string;
  };
  facility: {
    name: string;
    addressLines: string[];
    phone: string | null;
    licenseNumber: string | null;
    /** Where medication orders live (COL-389); null when the facility has not said. */
    medicationSystem: MedicationSystemOfRecord | null;
  };
  /** The Form 1823 the version was drafted from, when it named one. */
  form1823: { examDate: string | null; examinerName: string | null; examinerTitle: string | null } | null;
  sections: CarePlanPrintSection[];
  signature: CarePlanPrintSignature | null;
  /** Resident / representative acknowledgements of this version, newest first. */
  acknowledgements: CarePlanPrintAcknowledgement[];
  printedAt: string;
  printedBy: string;
};

export type CarePlanPrintPlanRow = {
  id: string;
  version: number | null;
  status: string;
  effective_date: string | null;
  review_due_date: string | null;
  notes: string | null;
  approved_at: string | null;
  signature_data: string | null;
};

export type CarePlanPrintItemRow = {
  id: string;
  category: string | null;
  title: string | null;
  description: string | null;
  assistance_level: string | null;
  frequency: string | null;
  goal: string | null;
  interventions: string[] | null;
  special_instructions: string | null;
  sort_order: number | null;
};

export type CarePlanPrintResidentRow = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  date_of_birth: string | null;
  beds?: Array<{ bed_label: string | null; rooms: { room_number: string | null } | null }> | null;
};

export type CarePlanPrintFacilityRow = {
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  phone: string | null;
  license_number: string | null;
  settings?: unknown;
};

/** Enum order from `care_plan_item_category` — the order a caregiver reads the plan, not alphabetical. */
const CATEGORY_ORDER = [
  "mobility",
  "bathing",
  "dressing",
  "grooming",
  "toileting",
  "eating",
  "medication_assistance",
  "behavioral",
  "fall_prevention",
  "skin_integrity",
  "pain_management",
  "cognitive",
  "social",
  "dietary",
  "other",
] as const;

function categoryRank(category: string): number {
  const index = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return index === -1 ? CATEGORY_ORDER.length : index;
}

export function groupCarePlanPrintItems(rows: CarePlanPrintItemRow[]): CarePlanPrintSection[] {
  const byCategory = new Map<string, CarePlanPrintItem[]>();
  const ordered = [...rows].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  for (const row of ordered) {
    const category = row.category?.trim() || "other";
    const list = byCategory.get(category) ?? [];
    list.push({
      id: row.id,
      title: row.title,
      description: row.description,
      assistanceLevel: row.assistance_level,
      frequency: row.frequency,
      goal: row.goal,
      interventions: (row.interventions ?? []).filter((line) => line.trim().length > 0),
      specialInstructions: row.special_instructions,
    });
    byCategory.set(category, list);
  }
  return [...byCategory.entries()]
    .sort((a, b) => categoryRank(a[0]) - categoryRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([category, items]) => ({ category, label: formatCarePlanPrintCategoryLabel(category), items }));
}

export function buildCarePlanPrintPacket(input: {
  plan: CarePlanPrintPlanRow;
  items: CarePlanPrintItemRow[];
  resident: CarePlanPrintResidentRow;
  facility: CarePlanPrintFacilityRow;
  approverName: string | null;
  supersededByVersion: number | null;
  acknowledgements?: CarePlanPrintAcknowledgementRow[];
  form1823?: { exam_date: string | null; physician_name: string | null; examiner_title: string | null } | null;
  printedAt: string;
  printedBy: string;
}): CarePlanPrintPacket {
  const { plan, resident, facility } = input;
  const bed = resident.beds?.[0] ?? null;
  const cityLine = [facility.city, facility.state].filter((part) => part && part.trim()).join(", ");
  const addressLines = [
    facility.address_line_1,
    facility.address_line_2,
    [cityLine, facility.zip].filter((part) => part && part.trim()).join(" "),
  ].filter((line): line is string => Boolean(line && line.trim()));

  return {
    plan: {
      id: plan.id,
      version: plan.version,
      status: plan.status,
      effectiveDate: plan.effective_date,
      reviewDueDate: plan.review_due_date,
      notes: plan.notes,
      supersededByVersion: input.supersededByVersion,
    },
    resident: {
      id: resident.id,
      name: formatCarePlanResidentName({ first_name: resident.first_name, last_name: resident.last_name }),
      dateOfBirth: resident.date_of_birth,
      room: formatCarePlanPrintRoom(bed?.rooms?.room_number, bed?.bed_label),
    },
    facility: {
      name: facility.name,
      addressLines,
      phone: facility.phone,
      licenseNumber: facility.license_number,
      medicationSystem: medicationSystemOfRecordFromSettings(facility.settings),
    },
    form1823: input.form1823
      ? { examDate: input.form1823.exam_date, examinerName: input.form1823.physician_name, examinerTitle: input.form1823.examiner_title }
      : null,
    sections: groupCarePlanPrintItems(input.items),
    // Only an approval instant proves a signature happened; signature_data alone does not.
    signature: plan.approved_at
      ? { approvedAt: plan.approved_at, approverName: input.approverName, signatureData: plan.signature_data }
      : null,
    acknowledgements: [...(input.acknowledgements ?? [])]
      .sort((a, b) => b.acknowledged_at.localeCompare(a.acknowledged_at))
      .map((row) => ({
        id: row.id,
        signerRole: row.signer_role,
        signerName: row.signer_name,
        relationship: row.relationship_to_resident,
        method: row.method,
        signatureData: row.signature_data,
        acknowledgedAt: row.acknowledged_at,
      })),
    printedAt: input.printedAt,
    printedBy: input.printedBy,
  };
}
