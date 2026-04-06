import { z } from "zod";

import { UUID_STRING_RE } from "@/lib/supabase/env";

export const caregiverIncidentCategoryValues = [
  "fall_with_injury",
  "fall_without_injury",
  "fall_unwitnessed",
  "medication_error",
  "medication_refusal",
  "behavioral_resident_to_resident",
  "behavioral_resident_to_staff",
  "elopement",
  "wandering",
  "environmental_flood",
  "environmental_fire",
  "other",
] as const;

export const caregiverIncidentShiftValues = ["day", "evening", "night", "custom"] as const;

export const caregiverIncidentSeverityValues = ["level_1", "level_2", "level_3", "level_4"] as const;

export const caregiverIncidentFormSchema = z.object({
  residentId: z
    .string()
    .refine((s) => s === "" || UUID_STRING_RE.test(s), "Choose a resident or leave blank"),
  category: z.enum(caregiverIncidentCategoryValues),
  severity: z.enum(caregiverIncidentSeverityValues),
  occurredAtLocal: z.string().min(1, "Date and time are required"),
  shift: z.enum(caregiverIncidentShiftValues),
  locationDescription: z.string().min(3, "Location is required").max(2000),
  description: z.string().min(10, "Describe what happened").max(8000),
  immediateActions: z.string().min(3, "Document immediate actions").max(8000),
  injuryOccurred: z.boolean(),
});

export type CaregiverIncidentFormData = z.infer<typeof caregiverIncidentFormSchema>;
