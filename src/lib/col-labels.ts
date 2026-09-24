import { COL_LABEL_NO_VALUE_COPY } from "@/lib/col-labels-display-copy";
import { enumLabel } from "@/lib/display/enum-label";

const COL_LABEL_OVERRIDES = {
  hospital_hold: "Bed Hold — Hospital or rehab",
  loa: "Bed Hold — Vacation/Family",
  semi_private: "Companion",
  private: "Private",
} as const;

type ColLabelFallback = "title" | "sentence";

type FormatColLabelOptions = {
  fallback?: ColLabelFallback;
};

export function formatColLabel(value: string | null | undefined, options: FormatColLabelOptions = {}) {
  return enumLabel(value, {
    overrides: COL_LABEL_OVERRIDES,
    empty: COL_LABEL_NO_VALUE_COPY,
    case: options.fallback ?? "title",
  });
}
