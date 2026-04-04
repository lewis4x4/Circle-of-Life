import { z } from "zod";

export const assessmentFormSchema = z.object({
  assessmentType: z.string().min(1, "Select an assessment type"),
  assessmentDate: z.string().min(1, "Assessment date is required"),
  scores: z.record(z.string(), z.number({ error: "Select a response" })),
  notes: z.string().max(4000).optional(),
});

export type AssessmentFormData = z.infer<typeof assessmentFormSchema>;
