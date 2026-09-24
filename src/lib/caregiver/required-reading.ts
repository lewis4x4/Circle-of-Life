/**
 * The floor app's one Required reading page (COL-707, Brian 2026-09-23): documents to
 * sign first, the pending-policy list as its second tab.
 */
export const REQUIRED_READING_HREF = "/caregiver/acknowledgments";
export const REQUIRED_READING_POLICIES_HREF = `${REQUIRED_READING_HREF}?tab=policies`;

export const REQUIRED_READING_TABS = [
  { id: "sign", label: "To sign", href: REQUIRED_READING_HREF },
  { id: "policies", label: "Policies", href: REQUIRED_READING_POLICIES_HREF },
] as const;

export type RequiredReadingTab = (typeof REQUIRED_READING_TABS)[number]["id"];

export function requiredReadingTab(tab: string | null): RequiredReadingTab {
  return tab === "policies" ? "policies" : "sign";
}
