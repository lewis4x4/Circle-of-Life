import type { ModulePromoter } from "./_types.ts";

// Item 1 intentionally ships the promotion shell only. Module promoters are added by later builders.
export const PROMOTERS: Record<string, ModulePromoter> = {};
