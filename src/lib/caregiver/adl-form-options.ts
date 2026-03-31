import type { Database } from "@/types/database";

export const ADL_OPTIONS: { value: string; label: string }[] = [
  { value: "bathing", label: "Bathing" },
  { value: "dressing", label: "Dressing" },
  { value: "toileting", label: "Toileting" },
  { value: "eating", label: "Eating" },
  { value: "mobility", label: "Mobility / transfer" },
  { value: "grooming", label: "Grooming" },
  { value: "rounding", label: "Safety round" },
  { value: "other", label: "Other" },
];

export const ASSIST_OPTIONS: { value: Database["public"]["Enums"]["assistance_level"]; label: string }[] = [
  { value: "independent", label: "Independent" },
  { value: "supervision", label: "Supervision" },
  { value: "limited_assist", label: "Limited assist" },
  { value: "extensive_assist", label: "Extensive assist" },
  { value: "total_dependence", label: "Total dependence" },
];

export function adlTypeLabel(value: string): string {
  return ADL_OPTIONS.find((o) => o.value === value)?.label ?? value.replace(/_/g, " ");
}

export function assistanceLabel(value: Database["public"]["Enums"]["assistance_level"]): string {
  return ASSIST_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
