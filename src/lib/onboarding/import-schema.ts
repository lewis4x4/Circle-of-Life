import { z } from "zod";

import { ANSWER_TYPES, IMPORTANCE_LEVELS } from "@/lib/onboarding/types";

const questionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9][a-z0-9._-]*$/i, "Use letters, numbers, dots, underscores, or hyphens (e.g. finance.ar.model)"),
    prompt: z.string().min(1).max(20000),
    helpText: z.string().max(20000).optional(),
    assignedTo: z.string().max(200).optional(),
    department: z.string().min(1).max(200),
    category: z.string().max(200).optional(),
    importance: z.enum(IMPORTANCE_LEVELS),
    answerType: z.enum(ANSWER_TYPES),
    required: z.boolean().optional(),
    options: z.array(z.string().min(1)).optional(),
    sortOrder: z.number().int().optional(),
    tier: z.enum(["core", "extended"]).optional(),
  })
  .superRefine((q, ctx) => {
    if (q.answerType === "single_select" && (!q.options || q.options.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "single_select questions must include a non-empty options array",
        path: ["options"],
      });
    }
    if (q.answerType !== "single_select" && q.options && q.options.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "options are only allowed for single_select",
        path: ["options"],
      });
    }
  });

export const onboardingImportFileSchemaV1 = z.object({
  version: z.literal(1),
  questions: z.array(questionSchema).min(1),
});

export type OnboardingImportFileV1Parsed = z.infer<typeof onboardingImportFileSchemaV1>;
