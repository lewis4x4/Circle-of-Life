import { describe, expect, it } from "vitest";

import {
  MEDICAL_EXAM_POST_DAYS as APP_MEDICAL_EXAM_POST_DAYS,
  MEDICAL_EXAM_PRIOR_DAYS as APP_MEDICAL_EXAM_PRIOR_DAYS,
} from "@/lib/admissions/reassessment";
import { defaultForm1823Expiration } from "@/lib/admissions/form-1823-renewal";
import {
  addDays,
  FORM_1823_DEFAULT_VALID_DAYS,
  MEDICAL_EXAM_POST_DAYS,
  MEDICAL_EXAM_PRIOR_DAYS,
} from "../../../supabase/functions/_shared/intake-type-checks";

// intake-type-checks.ts (Deno) restates these rule constants; the app owns them.
describe("intake type checks restate the app's rule constants", () => {
  it("admission exam window matches reassessment.ts", () => {
    expect(MEDICAL_EXAM_PRIOR_DAYS).toBe(APP_MEDICAL_EXAM_PRIOR_DAYS);
    expect(MEDICAL_EXAM_POST_DAYS).toBe(APP_MEDICAL_EXAM_POST_DAYS);
  });

  it.each(["2025-01-15", "2025-03-01", "2025-06-30", "2026-10-01", "2027-06-01"])(
    "Form 1823 default validity matches defaultForm1823Expiration for exam %s",
    (exam) => {
      expect(defaultForm1823Expiration(exam)).toBe(addDays(exam, FORM_1823_DEFAULT_VALID_DAYS));
    },
  );
});
