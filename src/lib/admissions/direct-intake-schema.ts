import { differenceInYears, parseISO, startOfDay } from "date-fns";
import * as z from "zod";

export type DirectAdmissionSourceValue =
  | "walk_in"
  | "hospital_discharge_no_referral"
  | "facility_transfer_no_referral"
  | "family_initiated"
  | "other";

export const DIRECT_ADMISSION_SOURCES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "hospital_discharge_no_referral", label: "Hospital discharge (no referral)" },
  { value: "facility_transfer_no_referral", label: "Facility transfer (no referral)" },
  { value: "family_initiated", label: "Family-initiated" },
  { value: "other", label: "Other" },
] as const satisfies ReadonlyArray<{ value: DirectAdmissionSourceValue; label: string }>;

export const DIRECT_INTAKE_GENDER_VALUES = [
  "male",
  "female",
  "non_binary",
  "prefer_not_to_say",
  "other",
] as const;

export type DirectIntakeGenderValue = (typeof DIRECT_INTAKE_GENDER_VALUES)[number];

export const NAME_SUFFIX_PRESETS = ["Jr.", "Sr.", "II", "III", "IV", "V"] as const;

function isoYmdStrict(v: string) {
  const t = v.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(t) ? t : null;
}

/** Required DOB: past date, age ≥ 18 (calendar years). */
export const directAdmitDobSchema = z
  .string()
  .trim()
  .min(1, "Date of birth is required.")
  .superRefine((raw, ctx) => {
    const ymd = isoYmdStrict(raw);
    if (!ymd) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a complete date of birth." });
      return;
    }
    let d: Date;
    try {
      d = parseISO(`${ymd}T12:00:00`);
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date of birth." });
      return;
    }
    const today = startOfDay(new Date());
    if (!Number.isFinite(d.getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Enter a valid date of birth." });
      return;
    }
    const dobDay = startOfDay(d);
    if (dobDay.getTime() >= today.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Date of birth must be in the past." });
      return;
    }
    const age = differenceInYears(today, dobDay);
    if (age < 18) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Resident must be 18 years or older.",
      });
    }
  });

export const directAdmitGenderSchema = z
  .string()
  .trim()
  .min(1, "Gender is required.")
  .refine((v): v is DirectIntakeGenderValue => DIRECT_INTAKE_GENDER_VALUES.includes(v as DirectIntakeGenderValue), {
    message: "Select a valid gender.",
  });

const CRM_REFERRAL_SOURCE_REGEX =
  /^src:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const directAdmitSourceSchema = z
  .string()
  .trim()
  .min(1, "Admission source is required.")
  .refine(
    (v) => CRM_REFERRAL_SOURCE_REGEX.test(v) || DIRECT_ADMISSION_SOURCES.some((s) => s.value === v),
    {
      message: "Select an admission source.",
    },
  );

export function admissionSourceLabel(v: DirectAdmissionSourceValue): string {
  const row = DIRECT_ADMISSION_SOURCES.find((s) => s.value === v);
  return row?.label ?? v;
}

export function genderDisplayLabel(v: string): string {
  const map: Record<string, string> = {
    male: "Male",
    female: "Female",
    non_binary: "Non-binary",
    prefer_not_to_say: "Prefer not to say",
    other: "Other",
  };
  return map[v] ?? v;
}

export const directAdmitSubmitSchema = z
  .object({
    firstName: z.string().trim().min(1, "First name is required."),
    lastName: z.string().trim().min(1, "Last name is required."),
    nameSuffix: z.string().trim().max(40).optional(),
    preferredName: z.string().trim().max(120).optional(),
    dob: directAdmitDobSchema,
    gender: directAdmitGenderSchema,
    genderOther: z.string().trim().max(500).optional(),
    phoneDigits: z.string().trim().max(20).optional(),
    source: directAdmitSourceSchema,
    sourceOther: z.string().trim().max(2000).optional(),
  })
  .superRefine((data, ctx) => {
    if (data.source === "other" && !data.sourceOther?.trim()) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceOther"],
        message: "Describe the admission source.",
      });
    }
  });

export type DirectAdmitSubmitInput = z.input<typeof directAdmitSubmitSchema>;

export function parseDirectAdmitForSubmit(input: DirectAdmitSubmitInput) {
  return directAdmitSubmitSchema.safeParse(input);
}

