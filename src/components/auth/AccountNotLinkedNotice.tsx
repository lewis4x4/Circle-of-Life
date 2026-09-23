import { UserX } from "lucide-react";

import type { AccountLinkContact } from "@/lib/auth/account-link";

/**
 * The one "your account isn't set up yet" state for portal logins with no
 * staff record (floor, med-tech) or no linked resident (family). Shown in
 * place of pages that would otherwise 403, print raw errors or show zeros
 * (COL-661).
 */
export function AccountNotLinkedNotice({
  kind,
  contact,
}: {
  kind: "staff" | "family";
  contact: AccountLinkContact | null;
}) {
  const who = contact?.administratorName ?? (kind === "staff" ? "your administrator" : "the facility office");
  const where = contact?.facilityName ? ` at ${contact.facilityName}` : "";
  const what =
    kind === "staff"
      ? "Your sign-in works, but it isn't linked to a staff record yet, so your shifts, rounds, medications and time clock can't load."
      : "Your sign-in works, but it isn't linked to a resident yet, so there is nothing to show here.";
  const ask = kind === "staff" ? "Ask them to link your login to your staff record." : "Ask them to send you an invitation link for your family member.";

  return (
    <section
      role="status"
      aria-labelledby="account-not-linked-title"
      className="mx-auto max-w-lg space-y-3 rounded-[var(--radius)] border border-border bg-card p-6 text-card-foreground"
    >
      <div className="flex items-center gap-3">
        <UserX className="h-6 w-6 shrink-0 text-muted-foreground" aria-hidden />
        <h2 id="account-not-linked-title" className="text-lg font-semibold">
          Your account isn&apos;t set up yet
        </h2>
      </div>
      <p className="text-sm text-muted-foreground">{what}</p>
      <p className="text-sm">
        Contact {who}
        {where}. {ask}
      </p>
      {contact?.phone ? (
        <a href={`tel:${contact.phone}`} className="inline-flex text-sm font-medium underline">
          Call {contact.phone}
        </a>
      ) : null}
    </section>
  );
}
