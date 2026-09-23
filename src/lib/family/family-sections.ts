/**
 * The family portal's sections — the one list both the bottom tab bar
 * (FamilyShell) and the in-page section pills (FamilySectionIntro) render,
 * so the two can no longer disagree (COL-655: the pills had 5 items, the bar
 * 6, and only the bar had "Documents").
 */
export type FamilySectionKey = "today" | "calendar" | "care" | "updates" | "documents" | "billing";

export type FamilySection = {
  key: FamilySectionKey;
  href: string;
  label: string;
  /** Route trees that belong to this section besides `href`. */
  also?: readonly string[];
};

export const FAMILY_SECTIONS: readonly FamilySection[] = [
  { key: "today", href: "/family", label: "Today" },
  { key: "calendar", href: "/family/calendar", label: "Calendar" },
  { key: "care", href: "/family/care-plan", label: "Care" },
  { key: "updates", href: "/family/messages", label: "Updates" },
  { key: "documents", href: "/family/benefits", label: "Documents" },
  { key: "billing", href: "/family/billing", label: "Billing", also: ["/family/invoices", "/family/payments"] },
];

/** The section that owns `pathname`; "Today" only on the portal root. */
export function activeFamilySection(pathname: string | null | undefined): FamilySectionKey | null {
  const path = (pathname ?? "").replace(/\/+$/, "") || "/";
  if (path === "/family") return "today";
  for (const section of FAMILY_SECTIONS) {
    if (section.key === "today") continue;
    for (const route of [section.href, ...(section.also ?? [])]) {
      if (path === route || path.startsWith(`${route}/`)) return section.key;
    }
  }
  return null;
}
