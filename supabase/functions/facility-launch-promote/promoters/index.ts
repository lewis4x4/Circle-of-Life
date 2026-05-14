import type { ModulePromoter } from "./_types.ts";
import { M1_PROMOTER } from "./M1.ts";
import { M2_PROMOTER } from "./M2.ts";
import { M3_PROMOTER } from "./M3.ts";
import { M17_PROMOTER } from "./M17.ts";
import { M6_PROMOTER } from "./M6.ts";
import { M10_PROMOTER } from "./M10.ts";
import { M11_PROMOTER } from "./M11.ts";
import { M13_PROMOTER } from "./M13.ts";
import { M14_PROMOTER } from "./M14.ts";
import { M16_PROMOTER } from "./M16.ts";
import { M18_PROMOTER } from "./M18.ts";
import { M19_PROMOTER } from "./M19.ts";

export const PROMOTERS: Record<string, ModulePromoter> = {
  M1: M1_PROMOTER,
  M2: M2_PROMOTER,
  M3: M3_PROMOTER,
  M17: M17_PROMOTER,
  M6: M6_PROMOTER,
  M10: M10_PROMOTER,
  M11: M11_PROMOTER,
  M13: M13_PROMOTER,
  M14: M14_PROMOTER,
  M16: M16_PROMOTER,
  M18: M18_PROMOTER,
  M19: M19_PROMOTER,
};
