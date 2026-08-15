/**
 * Quiet Operator copy for admin internal form submission detail rows.
 * Missing values name the gap once — never use silent em dashes in data cells.
 */

export const ADMIN_FORM_NO_VALUE_COPY = "No value posted";

/** Submission detail field display — names null/empty gaps; posted values stay literal. */
export function formatAdminFormFieldValue(
  value: string | number | boolean | null | undefined,
): string {
  if (value == null) return ADMIN_FORM_NO_VALUE_COPY;
  if (value === "") return ADMIN_FORM_NO_VALUE_COPY;
  return String(value);
}
