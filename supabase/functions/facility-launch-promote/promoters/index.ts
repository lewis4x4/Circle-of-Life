import type { ModulePromoter } from "./_types.ts";
import { M1_PROMOTER } from "./M1.ts";
import { M2_PROMOTER } from "./M2.ts";
import { M3_PROMOTER } from "./M3.ts";
import { M17_PROMOTER } from "./M17.ts";

export const PROMOTERS: Record<string, ModulePromoter> = {
  M1: M1_PROMOTER,
  M2: M2_PROMOTER,
  M3: M3_PROMOTER,
  M17: M17_PROMOTER,
};
