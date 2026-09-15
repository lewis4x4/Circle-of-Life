export type CodeStatusSemantic = "neutral" | "attention" | "critical";

/** Maps stored `code_status` strings → clinician-safe Quiet Operator labels. */
export function resolveCodeStatusPresentation(raw: string | null): {
  label: string;
  semantic: CodeStatusSemantic;
} {
  const v = (raw ?? "").trim().toLowerCase().replace(/\s+/g, "_");

  /* Missing documented code status — no colored pill (Quiet Operator absent-data rule). */
  if (!v) {
    return { label: "Not on file", semantic: "neutral" };
  }

  if (
    v === "full_code" ||
    v === "full" ||
    v === "resuscitative" ||
    v === "resuscitative_measures"
  ) {
    return { label: "Full code", semantic: "neutral" };
  }

  if (v.includes("hospice")) {
    return {
      label: "Hospice — palliative-focused goals of care",
      semantic: "critical",
    };
  }

  const hasDnr = v.includes("dnr") || v.includes("dnar") || v.includes("do_not_resuscitate");
  const hasDni =
    v.includes("dni") || v.includes("do_not_intubate") || v.includes("_dni");

  if (hasDnr && hasDni) {
    return { label: "DNR/DNI — Do not resuscitate / intubate", semantic: "attention" };
  }
  if (hasDni && !hasDnr) {
    return { label: "DNI — Do not intubate", semantic: "attention" };
  }
  if (hasDnr) {
    return { label: "DNR — Do not resuscitate", semantic: "attention" };
  }

  if (
    v.includes("comfort") ||
    v.includes("cmo") ||
    v.includes("allow_natural") ||
    v === "letting_go_plan"
  ) {
    return { label: "Comfort care only — no aggressive measures", semantic: "critical" };
  }

  /* Unknown / unmappable stored value — do not imply clinical state via warning/danger hue. */
  return { label: "Not on file", semantic: "neutral" };
}
