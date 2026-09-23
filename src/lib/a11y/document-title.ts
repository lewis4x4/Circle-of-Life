/** The root-layout metadata title every page used to share (COL-658). */
export const SITE_TITLE = "Haven — Circle of Life";

/** "Staff roster" → "Staff roster · Haven"; no heading → the site title. */
export function documentTitleFor(heading: string | null | undefined): string {
  const text = heading?.replace(/\s+/g, " ").trim();
  return text ? `${text} · Haven` : SITE_TITLE;
}
