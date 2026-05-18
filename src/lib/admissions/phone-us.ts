/** Strip non-digits and cap at 10 (NANP). */
export function digitsOnlyNanp(raw: string): string {
  return raw.replace(/\D/g, "").slice(0, 10);
}

/** Display mask: `(555) 123-4567` — incomplete segments allowed while typing. */
export function formatUsPhoneMask(raw: string): string {
  const d = digitsOnlyNanp(raw);
  if (!d.length) return "";
  const a = d.slice(0, 3);
  const b = d.slice(3, 6);
  const c = d.slice(6, 10);
  if (d.length <= 3) return `(${a}`;
  if (d.length <= 6) return `(${a}) ${b}`;
  return `(${a}) ${b}-${c}`;
}
