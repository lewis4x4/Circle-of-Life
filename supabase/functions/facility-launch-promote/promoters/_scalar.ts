import type {
  ModulePromoter,
  ModuleValues,
  PromotionContext,
  PromotionResult,
} from "./_types.ts";
import {
  configPromotionResult,
  hasAnyMeaningful,
  promoteConfigFields,
} from "./_config.ts";

export function createScalarConfigPromoter(spec: {
  moduleCode: string;
  description: string;
  table: string;
  fields: string[];
  summaryLabel: string;
}): ModulePromoter {
  return {
    moduleCode: spec.moduleCode,
    description: spec.description,
    prerequisites: ["facility"],
    canPromote(values: ModuleValues) {
      const ready = hasAnyMeaningful(values, spec.fields);
      return { ready, missing: ready ? [] : spec.fields };
    },
    async promote(
      ctx: PromotionContext,
      values: ModuleValues,
    ): Promise<PromotionResult> {
      const counts = await promoteConfigFields(ctx, values, {
        moduleCode: spec.moduleCode,
        table: spec.table,
        fields: spec.fields,
        summaryLabel: spec.summaryLabel,
      });
      return configPromotionResult(
        spec.moduleCode,
        spec.table,
        spec.summaryLabel,
        counts,
        [],
        ctx.dry_run,
      );
    },
  };
}
