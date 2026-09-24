/** Views of the one Family Connections surface (COL-707). */
export const FAMILY_CONNECTIONS_VIEWS = [
  { id: "connections", label: "Connections", href: "/admin/family-portal" },
  { id: "notes", label: "Family notes", href: "/admin/family-portal?tab=notes" },
] as const;

export type FamilyConnectionsView = (typeof FAMILY_CONNECTIONS_VIEWS)[number]["id"];

export function familyConnectionsView(tab: string | null): FamilyConnectionsView {
  return tab === "notes" ? "notes" : "connections";
}
