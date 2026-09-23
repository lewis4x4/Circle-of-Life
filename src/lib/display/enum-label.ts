/**
 * One way to turn a stored enum value into words a staff member reads (COL-652 / COL-653).
 *
 * Screens rendered `wrong_medication`, `AT_RISK`, `uti`, `ROOM_AND_BOARD` and "Ceo" because
 * each page did its own `.replace(/_/g, " ")`. Every select option, badge and subtitle that
 * shows an enum goes through `enumLabel`, with a per-domain override map for the values whose
 * right wording is not their spelling ("semi_private" is "Companion").
 */

/** Tokens that are read as letters, not words. Matched per word, case-insensitively. */
const ACRONYMS: Record<string, string> = {
  adl: "ADL",
  adls: "ADLs",
  ahca: "AHCA",
  alf: "ALF",
  api: "API",
  ar: "AR",
  cfo: "CFO",
  ceo: "CEO",
  cna: "CNA",
  coo: "COO",
  cpr: "CPR",
  don: "DON",
  ed: "ED",
  er: "ER",
  gl: "GL",
  hipaa: "HIPAA",
  hr: "HR",
  hud: "HUD",
  icu: "ICU",
  iddsi: "IDDSI",
  id: "ID",
  lpn: "LPN",
  mar: "MAR",
  osha: "OSHA",
  phq: "PHQ",
  po: "PO",
  prn: "PRN",
  rn: "RN",
  sms: "SMS",
  tb: "TB",
  uti: "UTI",
};

export type EnumLabelCase = "sentence" | "title" | "lower";

export type EnumLabelOptions = {
  /** Exact wording for values whose label is not their spelling. Keys are matched case-insensitively. */
  overrides?: Readonly<Record<string, string>>;
  /** Returned for null, undefined or blank. */
  empty?: string;
  /** Sentence case (Quiet Operator default), Title Case for proper-noun-like names, or lower case inside a sentence. */
  case?: EnumLabelCase;
};

function word(token: string, capitalise: boolean): string {
  const acronym = ACRONYMS[token];
  if (acronym) return acronym;
  return capitalise ? token.charAt(0).toUpperCase() + token.slice(1) : token;
}

export function enumLabel(value: string | null | undefined, options: EnumLabelOptions = {}): string {
  const raw = value?.trim();
  if (!raw) return options.empty ?? "—";
  const key = raw.toLowerCase();
  const override = options.overrides?.[raw] ?? options.overrides?.[key];
  if (override) return override;

  const tokens = key.split(/[\s_-]+/).filter(Boolean);
  const title = options.case === "title";
  const lower = options.case === "lower";
  return tokens.map((token, index) => word(token, !lower && (title || index === 0))).join(" ");
}

/** `{ value, label }` pairs for a select, in the order given. */
export function enumOptions<T extends string>(
  values: readonly T[],
  options: EnumLabelOptions = {},
): { value: T; label: string }[] {
  return values.map((value) => ({ value, label: enumLabel(value, options) }));
}
