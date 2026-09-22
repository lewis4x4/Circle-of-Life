import type { ResidentContactRowView } from "@/lib/residents/resident-detail-overview-load";

/**
 * The responsible party a resident record holds in its own columns.
 *
 * Haven has two places a resident's next of kin can live: a `resident_contacts`
 * row, and the `responsible_party_*` columns on `residents` that an imported or
 * hand-entered record fills in. The resident overview's Care contacts card only
 * ever read the first, so a resident whose responsible party was captured the
 * second way rendered "+ Add primary contact" while their name, relationship,
 * phone and email sat in memory on the same page.
 *
 * This is a read fallback, not a migration: the row it returns is marked as
 * coming from the resident record so the surface can say where it came from and
 * an operator can promote it to a real care contact. Contacts proper always win
 * — a `resident_contacts` row is the record a person maintained on purpose.
 */
export type ResponsiblePartySource = Pick<
  {
    responsiblePartyName: string | null;
    responsiblePartyRelationship: string | null;
    responsiblePartyPhone: string | null;
    responsiblePartyEmail: string | null;
  },
  | "responsiblePartyName"
  | "responsiblePartyRelationship"
  | "responsiblePartyPhone"
  | "responsiblePartyEmail"
>;

/** Synthetic id. Never a `resident_contacts.id` — nothing may write against it. */
export const RESPONSIBLE_PARTY_CONTACT_ID = "resident-record-responsible-party";

/** Stated on the card, because an operator should know this is not a care
 *  contact anyone has maintained, and that it should be promoted to one. */
export const RESPONSIBLE_PARTY_CONTACT_NOTE =
  "From the resident record's responsible party — not yet a care contact";

export type ResponsiblePartyContact = {
  row: ResidentContactRowView;
  note: string;
  email: string | null;
};

function trimmed(value: string | null | undefined): string | null {
  const next = value?.trim();
  return next && next.length > 0 ? next : null;
}

/**
 * The responsible party as a contact row, or null when the record holds no
 * name for one. A phone or an email with no name is not a contact — there is
 * nobody to ask for.
 */
export function responsiblePartyContact(
  detail: ResponsiblePartySource,
): ResponsiblePartyContact | null {
  const name = trimmed(detail.responsiblePartyName);
  if (!name) return null;

  const email = trimmed(detail.responsiblePartyEmail);
  return {
    row: {
      id: RESPONSIBLE_PARTY_CONTACT_ID,
      name,
      relationship: trimmed(detail.responsiblePartyRelationship),
      phone: trimmed(detail.responsiblePartyPhone),
      isEmergencyContact: true,
      isHealthcareProxy: false,
      isPowerOfAttorney: false,
      // Sorts behind every real contact, so it can only ever be the fallback.
      sortOrder: Number.MAX_SAFE_INTEGER,
      // No contact row means no maintained "last contact" date. Saying "not
      // recorded" is the truth; inventing one would be worse than the gap.
      updatedAt: null,
    },
    note: RESPONSIBLE_PARTY_CONTACT_NOTE,
    email,
  };
}
