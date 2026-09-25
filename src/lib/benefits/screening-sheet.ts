import { z } from "zod";

import { enumLabel } from "@/lib/display/enum-label";

/**
 * COL-770: the DOEA 701S (April 2013) telephone screening sheet, pre-filled only from this resident's record.
 * Every answer carries its source. Anything the record does not hold stays blank: Haven supplies no default or
 * canned answers, because these answers go to a state agency and must be true for this resident.
 */
const adl = z.enum(["independent", "supervision", "assistance", "dependent", "not_assessed"]).nullable();
export const screeningSheetFactsSchema = z.object({
  case_id: z.string().uuid(),
  resident: z.object({ first_name: z.string().nullable(), middle_name: z.string().nullable(), last_name: z.string().nullable(), date_of_birth: z.string().nullable(), gender: z.string().nullable(), phone: z.string().nullable() }),
  facility: z.object({ name: z.string().nullable(), address_line_1: z.string().nullable(), city: z.string().nullable(), zip: z.string().nullable() }),
  medicaid_number: z.string().nullable(),
  screening: z.object({ answered_at: z.string(), monthly_income_cents: z.number().int().nullable(), assets_cents: z.number().int().nullable() }).nullable(),
  forms_1823: z.array(z.object({
    id: z.string().uuid(), exam_date: z.string().nullable(), status: z.string(), is_current: z.boolean(), diagnoses: z.array(z.unknown()),
    adl_bathing: adl, adl_dressing: adl, adl_eating: adl, adl_toileting: adl, adl_transferring: adl, adl_walking: adl,
    medication_assistance: z.enum(["self_administered", "assistance_with_self_administration", "administered_by_licensed_staff", "not_assessed"]).nullable(),
  })),
  active_medication_count: z.number().int().min(0),
});
export type ScreeningSheetFacts = z.infer<typeof screeningSheetFactsSchema>;
export type SheetItem = { q: string; label: string; answer: string | null; source: string | null };
export type SheetSection = { title: string; items: SheetItem[] };

const usDate = (iso: string | null) => (iso && /^\d{4}-\d{2}-\d{2}/.test(iso) ? `${iso.slice(5, 7)}/${iso.slice(8, 10)}/${iso.slice(0, 4)}` : null);
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const clean = (value: string | null | undefined) => (value && value.trim() ? value.trim() : null);
const ADL_NEED: Record<string, string> = {
  independent: "No assistance needed",
  supervision: "Needs supervision or prompt",
  assistance: "Needs assistance (but not total help)",
  dependent: "Needs total assistance (cannot do at all)",
};
const MEDICATION_NEED: Record<string, string> = {
  self_administered: "No assistance needed",
  assistance_with_self_administration: "Needs assistance (but not total help)",
  administered_by_licensed_staff: "Needs total assistance (cannot do at all)",
};
const blank = (q: string, label: string): SheetItem => ({ q, label, answer: null, source: null });
const from = (q: string, label: string, answer: string | null, source: string): SheetItem => (answer ? { q, label, answer, source } : blank(q, label));

export function buildScreeningSheet(facts: ScreeningSheetFacts): SheetSection[] {
  const r = facts.resident, f = facts.facility, s = facts.screening;
  const record = "Resident record";
  const facilitySource = "Facility record";
  const screeningSource = s ? `Medicaid questions answered ${usDate(s.answered_at)}` : "";
  const latest = facts.forms_1823.find((form) => form.is_current) ?? facts.forms_1823[0] ?? null;
  const latestSource = latest ? `1823 dated ${usDate(latest.exam_date) ?? "(no exam date)"}` : "";
  const adlItem = (q: string, label: string, value: string | null | undefined) =>
    latest && value && ADL_NEED[value] ? { q, label, answer: ADL_NEED[value], source: `${latestSource}: ${enumLabel(value).toLowerCase()}` } : blank(q, label);
  const sex = r.gender === "female" ? "Female" : r.gender === "male" ? "Male" : null;
  const assetsBucket = s?.assets_cents == null ? null : s.assets_cents <= 200000 ? "$0 to $2,000" : s.assets_cents <= 500000 ? "$2,001 to $5,000" : "$5,001 or more";
  const diagnoses = facts.forms_1823.flatMap((form) =>
    form.diagnoses.filter((d): d is string => typeof d === "string" && d.trim().length > 0)
      .map((d) => ({ q: "42", label: "Health condition (from Form 1823)", answer: d.trim(), source: `1823 dated ${usDate(form.exam_date) ?? "(no exam date)"}` })));
  const meds = facts.active_medication_count;
  const medication = latest?.medication_assistance && MEDICATION_NEED[latest.medication_assistance]
    ? { q: "40g", label: "Managing medication (need)", answer: MEDICATION_NEED[latest.medication_assistance], source: `${latestSource}: ${enumLabel(latest.medication_assistance).toLowerCase()}` }
    : blank("40g", "Managing medication (need)");
  return [
    { title: "Identification", items: [
      blank("1", "SCREENER: Purpose of this assessment"),
      blank("2", "Social Security number"),
      from("3a", "First name", clean(r.first_name), record),
      from("3b", "Middle initial", clean(r.middle_name)?.charAt(0) ?? null, record),
      from("3c", "Last name", clean(r.last_name), record),
      from("4", "Medicaid number", clean(facts.medicaid_number), "Medicaid payer on file"),
      from("5", "Phone number", clean(r.phone), record),
      from("6", "Date of birth", usDate(r.date_of_birth), record),
      from("7", "Sex", sex, record),
      blank("8", "Race"), blank("9", "Ethnicity"), blank("10", "Primary language"),
      blank("11", "Limited ability reading, writing, speaking or understanding English"), blank("12", "Marital status"),
    ] },
    { title: "Location", items: [
      from("13a", "Current physical location: street", clean(f.address_line_1), facilitySource),
      from("13b", "City", clean(f.city), facilitySource),
      from("13c", "ZIP code", clean(f.zip), facilitySource),
      from("13d", "Type", f.name ? "Assisted living facility (ALF)" : null, facilitySource),
      from("13e", "Name", clean(f.name), facilitySource),
      blank("14", "Home address (if different)"), blank("15", "Mailing address (if different)"),
      blank("16", "SCREENER: Assessment date"), blank("17", "SCREENER: Referral date"), blank("18", "SCREENER: Referral source"),
      blank("19", "SCREENER: Transitioning out of a nursing facility?"), blank("20", "SCREENER: Imminent risk of nursing home placement?"),
    ] },
    { title: "Caregiver, living situation and money", items: [
      blank("21", "Is there a primary caregiver?"),
      from("22", "Living situation", f.name ? "With other" : null, f.name ? `Lives at ${f.name} (ALF)` : facilitySource),
      from("23", "Individual monthly income", s?.monthly_income_cents != null ? money(s.monthly_income_cents) : null, screeningSource),
      blank("24", "Couple monthly income"),
      from("25", "Estimated total individual assets", s?.assets_cents != null ? `${money(s.assets_cents)} (${assetsBucket})` : null, screeningSource),
      blank("26", "Estimated total couple assets"), blank("27", "Receiving SNAP (food stamps)?"), blank("28", "Need other assistance for food?"),
      blank("29", "SCREENER: Someone besides the client providing answers?"),
    ] },
    { title: "Health and care (answer from the resident's actual situation)", items: [
      blank("30", "Overall health at this time"), blank("31", "Health compared to a year ago"),
      blank("32", "Things you cannot do because of physical problems"), blank("33", "When you need medical care, how often do you get it?"),
      blank("34", "Transportation to medical care"), blank("35", "Finances/insurance allow healthcare and medications"),
      blank("36", "Told of memory loss, cognitive impairment, dementia or Alzheimer's"), blank("37", "In a nursing or rehabilitation facility in the last year?"),
    ] },
    { title: "Q38 — Assistance needed (ADLs)", items: [
      adlItem("38a", "Bathing", latest?.adl_bathing), adlItem("38b", "Dressing", latest?.adl_dressing), adlItem("38c", "Eating", latest?.adl_eating),
      adlItem("38d", "Using the bathroom", latest?.adl_toileting), adlItem("38e", "Transferring", latest?.adl_transferring), adlItem("38f", "Walking/Mobility", latest?.adl_walking),
      blank("39", "Assistance you have with these tasks (a–f)"),
    ] },
    { title: "Q40 — Assistance needed (IADLs)", items: [
      blank("40a", "Heavy chores"), blank("40b", "Light housekeeping"), blank("40c", "Using the telephone"), blank("40d", "Managing money"),
      blank("40e", "Preparing meals"), blank("40f", "Shopping"), medication, blank("40h", "Using transportation"),
      blank("41", "Assistance you have with these tasks (a–h)"),
    ] },
    { title: "Q42 — Health conditions told by a physician (every Form 1823 on file)", items: diagnoses.length ? diagnoses : [blank("42", "No diagnoses recorded on a Form 1823 in Haven")] },
    { title: "Therapies, caregiver and nutrition", items: [
      blank("43", "Frequency of current therapies or specialty care"),
      blank("44–49", "Caregiver name, phone, strain, health, confidence, crisis"),
      blank("50–56", "Nutritional risk: meals, eating alone, servings, weight change, special diet, chewing or swallowing"),
      from("57", "Three or more prescribed or over-the-counter medications a day?", meds >= 3 ? "Yes" : meds > 0 ? "No" : null, `Active medication list: ${meds}`),
      blank("58", "Days a week drinking alcohol"),
    ] },
  ];
}
