import { COL_LABEL_NO_VALUE_COPY } from "@/lib/col-labels-display-copy";

const COL_LABEL_OVERRIDES = {
  hospital_hold: "Bed Hold — Hospital",
  loa: "Bed Hold — Vacation/Family",
  semi_private: "Companion",
  private: "Private",
} as const;

type ColLabelFallback = "title" | "sentence";

type FormatColLabelOptions = {
  fallback?: ColLabelFallback;
};

function toTitleCase(value: string) {
  return value
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function toSentenceCase(value: string) {
  if (!value) return "";
  return value.charAt(0).toUpperCase() + value.slice(1);
}

export function formatColLabel(value: string | null | undefined, options: FormatColLabelOptions = {}) {
  if (!value) return COL_LABEL_NO_VALUE_COPY;
  const normalized = value.trim().toLowerCase();
  const override = COL_LABEL_OVERRIDES[normalized as keyof typeof COL_LABEL_OVERRIDES];
  if (override) return override;

  const readable = normalized.replace(/[_-]+/g, " ");
  const fallback = options.fallback ?? "title";
  return fallback === "sentence" ? toSentenceCase(readable) : toTitleCase(readable);
}
