import type { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

export type PromotionMode = "apply" | "dry_run";

export type ModuleValues = Record<string, unknown>;

export type TablesTouched = Array<{
  table: string;
  rows_created: number;
  rows_updated: number;
  rows_noop?: number;
}>;

export type PromotionStatus = "promoted" | "skipped" | "partial" | "failed";

export type RunItemStatus = PromotionStatus | "not_implemented" | "running";

export type PromotionResult = {
  module_code: string;
  status: PromotionStatus;
  summary: string;
  tables_touched: TablesTouched;
  warnings: string[];
  errors: string[];
  prerequisites_unmet: string[];
};

export type ResponseModuleStatus = PromotionStatus | "not_implemented";

export type ModulePromotionResult = Omit<PromotionResult, "status"> & {
  status: ResponseModuleStatus;
};

export type PromotionResponse = {
  run_id: string | null;
  organization_id: string;
  facility_id: string;
  mode: PromotionMode;
  modules_promoted: ModulePromotionResult[];
  summary: string;
  gap_modules: string[];
};

export type ModuleValueRow = {
  id: string;
  module_code: string;
  field_path: string;
  value: unknown;
};

export type PromotionContext = {
  admin: SupabaseClient;
  organization_id: string;
  facility_id: string;
  actor_user_id: string;
  dry_run: boolean;
  run_id: string | null;
  run_item_id: string | null;
  module_value_ids_by_path: Record<string, string>;
};

export type ReadinessCheck = { ready: boolean; missing: string[] };

export interface ModulePromoter {
  moduleCode: string;
  description: string;
  prerequisites: string[];
  canPromote(values: ModuleValues): ReadinessCheck;
  promote(
    ctx: PromotionContext,
    values: ModuleValues,
  ): Promise<PromotionResult>;
}
