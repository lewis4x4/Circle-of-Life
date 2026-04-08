import type { OnboardingQuestion } from "@/lib/onboarding/types";

import { CORE_ONBOARDING_QUESTIONS } from "@/lib/onboarding/seed-questions-core";
import { EXTENDED_DISCOVERY_QUESTIONS } from "@/lib/onboarding/seed-questions-extended";

export { CORE_ONBOARDING_QUESTIONS } from "@/lib/onboarding/seed-questions-core";
export { EXTENDED_DISCOVERY_QUESTIONS } from "@/lib/onboarding/seed-questions-extended";

/** Full library: Core first, then Extended (matches DB seed + import merge order). */
export const DEFAULT_ONBOARDING_QUESTIONS: OnboardingQuestion[] = [
  ...CORE_ONBOARDING_QUESTIONS,
  ...EXTENDED_DISCOVERY_QUESTIONS,
];
